
import { ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { getMatrixTranslation, invlerp, transformVec3Mat4w0, Vec3Zero } from "../MathHelpers";
import { assert, assertExists, fallback, leftPad } from "../util";
import { ViewerRenderInput } from "../viewer";
import { calcSqDistanceToPlayer, connectToScene, getAreaObj, getPlayerPos, vecKillElement } from "./ActorUtil";
import { AreaFormType, AreaObj } from "./AreaObj";
import { getJMapInfoArg0, JMapInfoIter,  } from "./JMapInfo";
import { connectToSceneLayout, createAndAddPaneCtrl, getPaneAnimFrameMax, hideScreen, LayoutActor, setAnimFrameAndStopAdjustTextWidth, setTextBoxRecursive, showLayout, showScreen } from "./Layout";
import { LiveActor, ZoneAndLayer } from "./LiveActor";
import { SceneObj, SceneObjHolder } from "./Main";
import { JUTMesgFlowNode, JUTMesgFlowNodeBranch, JUTMesgFlowNodeEvent, JUTMesgFlowNodeType, TalkMessageInfo } from "./MessageData";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "./NameObj";

function connectToSceneTalkLayout(sceneObjHolder: SceneObjHolder, actor: LayoutActor): void {
    connectToScene(sceneObjHolder, actor, MovementType.Layout, CalcAnimType.Layout, DrawBufferType.None, DrawType.TalkLayout);
}

function calcLayoutPositionFromWorld(dst: vec3, v: ReadonlyVec3, viewerInput: ViewerRenderInput): void {
    vec3.transformMat4(dst, v, viewerInput.camera.clipFromWorldMatrix);
}

function getJMapInfoMessageID(infoIter: JMapInfoIter): number | null {
    return infoIter.getValueNumber('MessageId');
}

const enum TalkType {
    Short = 1,
    Event = 2,
    Flow = 4,
    Null = 5,
}

function isNodeEventContinue(node: JUTMesgFlowNodeEvent): boolean {
    return false;
}

const enum BranchType {
    None = 0,
    User = 1,
    IsNearPlayer = 2,
    SwitchA = 3,
    SwitchB = 4,
    IsPlayerNormal = 5,
    IsPlayerBee = 6,
    IsPlayerTeresa = 7,
    IsPowerStarAppeared = 8,
    IsTalkAlreadyDone = 9,
    IsPlayerLuigi = 10,
    AstroGalaxyBranch = 11,
    IsTimeKeepDemoActive = 12,
    IsMessageAlreadyRead = 13,
    IsMessageLedPattern = 14,
}

class TalkNodeCtrl {
    private rootNode: JUTMesgFlowNode | null = null;
    private currentNode: JUTMesgFlowNode | null = null;
    private tempFlowNode: JUTMesgFlowNode | null = null;

    public talkMessageInfo = new TalkMessageInfo();

    constructor(sceneObjHolder: SceneObjHolder) {
    }

    private messageKey: string;
    public createFlowNode(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl, infoIter: JMapInfoIter, actorName: string): void {
        const messageID = assertExists(getJMapInfoMessageID(infoIter));
        const zoneName = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter)!.zoneName;
        const messageKey = `${zoneName}_${actorName}${leftPad('' + messageID, 3)}`;
        this.createFlowNodeDirect(sceneObjHolder, messageCtrl, messageKey);
    }

    public createFlowNodeDirect(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl, messageKey: string): void {
        const sceneData = sceneObjHolder.messageHolder.sceneData;
        if (sceneData === null)
            return;

        this.messageKey = messageKey;
        this.rootNode = sceneData.findNode(messageKey);
        this.currentNode = this.rootNode;
        this.tempFlowNode = this.rootNode;

        if (this.currentNode !== null) {
            this.updateMessage(sceneObjHolder);

            if (this.talkMessageInfo.talkType === TalkType.Flow) {
                this.forwardFlowNode(sceneObjHolder);
                this.rootNode = this.currentNode;
                this.tempFlowNode = this.currentNode;
            }
        } else {
            sceneData.getMessageDirect(this.talkMessageInfo, messageKey);
        }
    }

    private getNextNode(sceneObjHolder: SceneObjHolder): JUTMesgFlowNode | null {
        const sceneData = sceneObjHolder.messageHolder.sceneData!;

        const node = this.currentNode!;
        if (node.type === JUTMesgFlowNodeType.Message) {
            if (node.nextNodeIndex !== 0xFFFF)
                return sceneData.getNode(node.nextNodeIndex);
        } else if (node.type === JUTMesgFlowNodeType.Event) {
            const branchNode = sceneData.getBranchNode(node.branchInfoIndex);
            if (branchNode !== null)
                return branchNode;
        }

        return null;
    }

    public getCurrentNodeBranch(): JUTMesgFlowNodeBranch | null {
        const node = this.currentNode;
        if (node !== null && node.type === JUTMesgFlowNodeType.Branch)
            return node;
        return null;
    }

    public getCurrentNodeEvent(): JUTMesgFlowNodeEvent | null {
        const node = this.currentNode;
        if (node !== null && node.type === JUTMesgFlowNodeType.Event)
            return node;
        return null;
    }

    private getNextNodeBranch(sceneObjHolder: SceneObjHolder): JUTMesgFlowNodeBranch | null {
        const node = this.getNextNode(sceneObjHolder);
        if (node !== null && node.type === JUTMesgFlowNodeType.Branch)
            return node;
        return null;
    }

    private getNextNodeEvent(sceneObjHolder: SceneObjHolder): JUTMesgFlowNodeEvent | null {
        const node = this.getNextNode(sceneObjHolder);
        if (node !== null && node.type === JUTMesgFlowNodeType.Event)
            return node;
        return null;
    }

    private updateMessage(sceneObjHolder: SceneObjHolder): void {
        if (this.currentNode === null)
            return;

        if (this.currentNode.type === JUTMesgFlowNodeType.Message) {
            const sceneData = sceneObjHolder.messageHolder.sceneData!;
            sceneData.getMessage(this.talkMessageInfo, this.currentNode.messageGroupID, this.currentNode.messageIndex);
        } else {
            this.talkMessageInfo.message = null;
        }
    }

    public resetTempFlowNode(sceneObjHolder: SceneObjHolder): void {
        this.currentNode = this.tempFlowNode;
        this.updateMessage(sceneObjHolder);
    }

    public forwardFlowNode(sceneObjHolder: SceneObjHolder): void {
        if (this.currentNode === null)
            return;

        const nextNode = this.getNextNode(sceneObjHolder);
        if (nextNode !== null)
            this.currentNode = nextNode;

        this.updateMessage(sceneObjHolder);
    }

    public forwardCurrentBranchNode(sceneObjHolder: SceneObjHolder, takeLeft: boolean): void {
        const sceneData = sceneObjHolder.messageHolder.sceneData!;
        const branchNode = assertExists(this.getCurrentNodeBranch());
        const branchIndex = branchNode.branchInfoIndex + (takeLeft ? 1 : 0);
        this.currentNode = sceneData.getBranchNode(branchIndex);
        this.updateMessage(sceneObjHolder);
    }
}

const enum TalkState {
    None,
    Entry,
    EnableStart,
    Talking,
    EnableEnd,
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

export class TalkMessageCtrl {
    private offset = vec3.create();
    private talkNodeCtrl: TalkNodeCtrl;
    public balloonPos = vec3.create();
    public rootNodeAutomatic = false;
    public talkState = TalkState.None;
    public distanceToTalk = 500.0;

    constructor(sceneObjHolder: SceneObjHolder, public host: LiveActor, offset: ReadonlyVec3 = Vec3Zero, private hostMtx: ReadonlyMat4 | null) {
        vec3.copy(this.offset, offset);
        sceneObjHolder.create(SceneObj.TalkDirector);
        this.talkNodeCtrl = new TalkNodeCtrl(sceneObjHolder);
    }

    private isCurrentNodeContinue(): boolean {
        const eventNode = this.talkNodeCtrl.getCurrentNodeEvent();
        if (eventNode !== null)
            return isNodeEventContinue(eventNode);
        else
            return false;
    }

    private runBranch(sceneObjHolder: SceneObjHolder, node: JUTMesgFlowNodeBranch): boolean {
        const branchType = node.nodeData as BranchType;

        switch (branchType) {
        case BranchType.IsPlayerNormal:
            return true;
        default:
            return false;
        }
    }

    public rootNodePre(sceneObjHolder: SceneObjHolder, shouldContinue: boolean): void {
        this.talkNodeCtrl.resetTempFlowNode(sceneObjHolder);

        while (true) {
            while (true) {
                const branchNode = this.talkNodeCtrl.getCurrentNodeBranch();
                if (branchNode === null)
                    break;

                const branchPath = this.runBranch(sceneObjHolder, branchNode);
                this.talkNodeCtrl.forwardCurrentBranchNode(sceneObjHolder, branchPath);
            }

            if (!shouldContinue || !this.isCurrentNodeContinue())
                break;
            this.talkNodeCtrl.forwardFlowNode(sceneObjHolder);
        }
    }

    private inMessageArea(sceneObjHolder: SceneObjHolder, v: ReadonlyVec3): boolean {
        const areaObj = getAreaObj<MessageArea>(sceneObjHolder, 'MessageArea', v);
        if (areaObj === null)
            return false;

        const zoneId = this.host.zoneAndLayer.zoneId;
        if (areaObj.zoneAndLayer.zoneId === zoneId && areaObj.messageAreaId === this.talkNodeCtrl.talkMessageInfo.messageAreaId)
            return true;

        return false;
    }

    public isNearPlayer(sceneObjHolder: SceneObjHolder, maxDist: number): boolean {
        if (this.isTalkType(TalkType.Null))
            return false;

        getPlayerPos(scratchVec3b, sceneObjHolder);
        if (this.inMessageArea(sceneObjHolder, scratchVec3b))
            return true;

        if (this.hostMtx !== null)
            getMatrixTranslation(scratchVec3a, this.hostMtx);
        else
            vec3.copy(scratchVec3a, this.host.translation);

        vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        vecKillElement(scratchVec3a, scratchVec3a, this.host.gravityVector);
        if (vec3.squaredLength(scratchVec3a) <= maxDist**2.0)
            return true;

        return false;
    }

    public isCloserToPlayer(sceneObjHolder: SceneObjHolder, other: TalkMessageCtrl | null): boolean {
        if (other === null)
            return true;

        return calcSqDistanceToPlayer(sceneObjHolder, this.host) <= calcSqDistanceToPlayer(sceneObjHolder, other.host);
    }

    public isTalkType(type: TalkType): boolean {
        return this.talkNodeCtrl.talkMessageInfo.talkType === type;
    }

    public isTalking(): boolean {
        return this.talkState === TalkState.Talking;
    }

    public createMessage(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, actorName: string): void {
        this.talkNodeCtrl.createFlowNode(sceneObjHolder, this, infoIter, actorName);
    }

    public createMessageDirect(sceneObjHolder: SceneObjHolder, messageId: string): void {
        this.talkNodeCtrl.createFlowNodeDirect(sceneObjHolder, this, messageId);
    }

    public getMessage(): string {
        return assertExists(this.talkNodeCtrl.talkMessageInfo.message);
    }

    public updateBalloonPos(sceneObjHolder: SceneObjHolder): void {
        transformVec3Mat4w0(this.balloonPos, sceneObjHolder.viewerInput.camera.worldMatrix, this.offset);

        const hostMtx = this.hostMtx !== null ? this.hostMtx : this.host.getBaseMtx()!;
        this.balloonPos[0] += hostMtx[12];
        this.balloonPos[1] += hostMtx[13];
        this.balloonPos[2] += hostMtx[14];

        calcLayoutPositionFromWorld(this.balloonPos, this.balloonPos, sceneObjHolder.viewerInput);
    }
}

class TalkTextFormer {
    private message: string = '';
    private mode = 0;

    constructor(private actor: LayoutActor, private paneName: string) {
    }

    public formMessage(message: string, mode: number): void {
        this.message = message;
        this.mode = mode;
        setTextBoxRecursive(this.actor, this.paneName, this.message);
    }

    public updateTalking(sceneObjHolder: SceneObjHolder): void {
    }
}

class TalkBalloon<T extends number> extends LayoutActor<T> {
    public messageCtrl: TalkMessageCtrl | null = null;
    protected textFormer: TalkTextFormer;

    constructor(sceneObjHolder: SceneObjHolder, layoutName: string, private useBalloon: boolean, isTalkLayout: boolean) {
        super(sceneObjHolder, layoutName);

        if (isTalkLayout)
            connectToSceneTalkLayout(sceneObjHolder, this);
        else
            connectToSceneLayout(sceneObjHolder, this);

        this.initLayoutManager(sceneObjHolder, layoutName, 2);
        if (useBalloon !== null)
            createAndAddPaneCtrl(this, 'Balloon', 1);

        this.textFormer = new TalkTextFormer(this, `Text00`);
        hideScreen(this);
    }

    public open(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl): void {
        this.messageCtrl = messageCtrl;
        this.startAnim('Appear');
        if (this.useBalloon)
            this.startPaneAnim('Balloon', 'Beak');
    }

    public close(): void {
        this.startAnim('End');
    }

    public updateBalloon(sceneObjHolder: SceneObjHolder): void {
        if (this.messageCtrl === null)
            return;

        this.messageCtrl.updateBalloonPos(sceneObjHolder);

        if (this.useBalloon) {
            const beak = this.layoutManager!.getPane('PicBeak');
            getMatrixTranslation(scratchVec3a, beak.worldFromLocalMatrix);
            vec3.sub(scratchVec3a, this.layoutManager!.getRootPane().translation, scratchVec3a);
            vec3.normalize(scratchVec3a, scratchVec3a);

            const theta = invlerp(0, Math.PI, Math.acos(scratchVec3a[0]));
            const frame = theta * getPaneAnimFrameMax(this, 'Balloon', 0);
            this.setPaneAnimFrameAndStop(frame, 'Balloon', 0);
        }
    }

    public updateTalking(sceneObjHolder: SceneObjHolder): void {
        this.updateBalloon(sceneObjHolder);
        this.textFormer.updateTalking(sceneObjHolder);
    }
}

function countMessageLine(line: string): number {
    let nextIndex = undefined;
    let count = 0;
    while (true) {
        nextIndex = line.indexOf('\n', nextIndex);
        count++;
        if (nextIndex === -1)
            break;
        nextIndex++;
    }
    return count;
}

function calcScreenPosition(dst: vec3, v: ReadonlyVec3, viewerInput: ViewerRenderInput): void {
    dst[0] = (v[0] * 0.5 + 0.5) * viewerInput.backbufferWidth;
    dst[1] = (v[1] * 0.5 + 0.5) * viewerInput.backbufferHeight;
    dst[2] = 0.0;
}

const enum TalkBalloonShortNrv { Wait, Open, Talk, Close }
class TalkBalloonShort extends TalkBalloon<TalkBalloonShortNrv> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'TalkBalloonStretch', true, false);

        this.initNerve(TalkBalloonShortNrv.Talk);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TalkBalloonShortNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TalkBalloonShortNrv.Open) {
            this.updateTalking(sceneObjHolder);
            if (this.isAnimStopped(0))
                this.setNerve(TalkBalloonShortNrv.Talk);
        } else if (currentNerve === TalkBalloonShortNrv.Talk) {
            this.updateBalloon(sceneObjHolder);
        } else if (currentNerve === TalkBalloonShortNrv.Close) {
            this.updateTalking(sceneObjHolder);
            if (this.isAnimStopped(0))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public override open(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl): void {
        super.open(sceneObjHolder, messageCtrl);
        showScreen(this);
        this.makeActorAppeared(sceneObjHolder);

        const message = messageCtrl.getMessage();
        this.textFormer.formMessage(message, 0);
        // setArg

        const numLine = countMessageLine(message);
        if (numLine >= 2)
            this.startAnim('TwoLine', 1);
        else
            this.startAnim('OneLine', 1);

        setAnimFrameAndStopAdjustTextWidth(this, 'TxtText', 1);
        this.setNerve(TalkBalloonShortNrv.Open);
    }

    public override close(): void {
        this.startAnim('End', 0);
        this.setNerve(TalkBalloonShortNrv.Close);
    }

    public override updateBalloon(sceneObjHolder: SceneObjHolder): void {
        super.updateBalloon(sceneObjHolder);

        const z = this.messageCtrl!.balloonPos[2];
        if (z >= sceneObjHolder.viewerInput.camera.clipSpaceNearZ)
            showScreen(this);
        else
            hideScreen(this);

        const rootPane = this.layoutManager!.getRootPane();
        calcScreenPosition(rootPane.translation, this.messageCtrl!.balloonPos, sceneObjHolder.viewerInput);

        const scale = sceneObjHolder.viewerInput.backbufferWidth / 960;
        vec2.set(rootPane.scale, scale, scale);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        super.requestArchives(sceneObjHolder);
        sceneObjHolder.modelCache.requestLayoutData('TalkBalloonStretch');
    }
}

export class TalkDirector extends NameObj {
    private talkBalloonShort: TalkBalloonShort[] = [];
    private talkCtrlPotential: TalkMessageCtrl | null = null;
    private talkCtrlCurrent: TalkMessageCtrl | null = null;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'TalkDirector');
        connectToScene(sceneObjHolder, this, MovementType.TalkDirector, CalcAnimType.None, DrawBufferType.None, DrawType.None);
    }

    public request(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl, force: boolean): boolean {
        // TODO(jstpierre): Turn this on eventually
        return false;

        if (messageCtrl.rootNodeAutomatic)
            messageCtrl.rootNodePre(sceneObjHolder, false);

        if (messageCtrl.isTalkType(TalkType.Short)) {
            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, messageCtrl.host.translation);
            if (!messageCtrl.isNearPlayer(sceneObjHolder, messageCtrl.distanceToTalk))
                return false;
            if (!messageCtrl.isCloserToPlayer(sceneObjHolder, this.talkCtrlPotential))
                return false;

            this.talkCtrlPotential = messageCtrl;
            return true;
        }

        return false;
    }

    private findBalloonShort(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl): TalkBalloonShort {
        for (let i = 0; i < this.talkBalloonShort.length; i++) {
            const balloon = this.talkBalloonShort[i];
            if (balloon.messageCtrl === messageCtrl)
                return balloon;
        }

        const balloon = new TalkBalloonShort(sceneObjHolder);
        this.talkBalloonShort.push(balloon);
        return balloon;
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        if (this.talkCtrlPotential !== this.talkCtrlCurrent) {
            if (this.talkCtrlCurrent !== null) {
                const balloon = this.findBalloonShort(sceneObjHolder, this.talkCtrlCurrent);
                balloon.close();
                this.talkCtrlCurrent = null;
            }

            if (this.talkCtrlPotential !== null) {
                this.talkCtrlCurrent = this.talkCtrlPotential;
                const balloon = this.findBalloonShort(sceneObjHolder, this.talkCtrlCurrent);
                balloon.open(sceneObjHolder, this.talkCtrlCurrent);
            }
        }

        this.talkCtrlPotential = null;
    }

    public start(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl): boolean {
        return true;
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        TalkBalloonShort.requestArchives(sceneObjHolder);
    }
}

export function tryTalkNearPlayer(sceneObjHolder: SceneObjHolder, messageCtrl: TalkMessageCtrl | null): boolean {
    if (messageCtrl === null)
        return false;

    const talkDirector = sceneObjHolder.talkDirector!;
    if (talkDirector.request(sceneObjHolder, messageCtrl, false))
        return talkDirector.start(sceneObjHolder, messageCtrl);

    return false;
}

export function createTalkCtrl(sceneObjHolder: SceneObjHolder, host: LiveActor, infoIter: JMapInfoIter, actorName: string, offset: ReadonlyVec3 = Vec3Zero, hostMtx: ReadonlyMat4 | null): TalkMessageCtrl | null {
    if (getJMapInfoMessageID(infoIter) === null)
        return null;

    const ctrl = new TalkMessageCtrl(sceneObjHolder, host, offset, hostMtx);
    ctrl.createMessage(sceneObjHolder, infoIter, actorName);
    return ctrl;
}

export function createTalkCtrlDirect(sceneObjHolder: SceneObjHolder, host: LiveActor, messageId: string, offset: ReadonlyVec3 = Vec3Zero, hostMtx: ReadonlyMat4 | null): TalkMessageCtrl | null {
    const ctrl = new TalkMessageCtrl(sceneObjHolder, host, offset, hostMtx);
    ctrl.createMessageDirect(sceneObjHolder, messageId);
    return ctrl;
}

export class MessageArea extends AreaObj {
    public messageAreaId: number;

    protected override parseArgs(infoIter: JMapInfoIter): void {
        this.messageAreaId = fallback(getJMapInfoArg0(infoIter), -1);
    }

    public override getManagerName(): string {
        return 'MessageArea';
    }
}

export function createMessageAreaCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
    return new MessageArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.BaseOriginCube);
}

export function createMessageAreaCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
    return new MessageArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.BaseOriginCylinder);
}
