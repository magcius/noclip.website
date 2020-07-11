
// Misc NPC actors.

import { quat, vec3 } from 'gl-matrix';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { isNearZero, MathConstants, quatFromEulerRadians, Vec3Zero } from '../MathHelpers';
import { assertExists, fallback } from '../util';
import { adjustmentRailCoordSpeed, blendQuatUpFront, calcGravity, connectToSceneIndirectNpc, connectToSceneNpc, getNextRailPointNo, getRailCoordSpeed, getRailDirection, getRailPos, getRandomInt, initDefaultPos, isBckExist, isBckStopped, isExistRail, isRailReachedGoal, makeMtxTRFromQuatVec, makeQuatUpFront, moveCoordAndTransToNearestRailPos, moveRailRider, reverseRailDirection, setBckFrameAtRandom, setBrkFrameAndStop, startAction, startBck, startBckNoInterpole, startBrk, startBtk, startBva, tryStartAction, turnQuatYDirRad, useStageSwitchSleep } from './ActorUtil';
import { getFirstPolyOnLineToMap } from './Collision';
import { createCsvParser, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg7, JMapInfoIter } from './JMapInfo';
import { isDead, LiveActor, makeMtxTRFromActor, ZoneAndLayer } from './LiveActor';
import { getObjectName, SceneObjHolder } from './Main';
import { PartsModel } from './MiscActor';
import { DrawBufferType } from './NameObj';
import { isConnectedWithRail } from './RailRider';
import { isFirstStep, isGreaterStep } from './Spine';
import { ViewerRenderInput } from '../viewer';

// Scratchpad
const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

function createPartsModelNpcAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC);
    model.initFixedPositionJoint(jointName, localTrans);
    return model;
}

function createPartsModelIndirectNpc(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.INDIRECT_NPC);
    model.initFixedPositionJoint(jointName, localTrans);
    return model;
}

function createIndirectNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = createPartsModelIndirectNpc(sceneObjHolder, parentActor, objName, jointName, localTrans);
    model.initLightCtrl(sceneObjHolder);
    return model;
}

function createNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = createPartsModelNpcAndFix(sceneObjHolder, parentActor, objName, jointName);
    model.initLightCtrl(sceneObjHolder);
    return model;
}

function requestArchivesForNPCGoods(sceneObjHolder: SceneObjHolder, npcName: string, index: number): void {
    const modelCache = sceneObjHolder.modelCache;

    const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(npcName, index);
    if (itemGoods !== null) {
        if (itemGoods.goods0)
            modelCache.requestObjectData(itemGoods.goods0);

        if (itemGoods.goods1)
            modelCache.requestObjectData(itemGoods.goods1);
    }
}

class NPCActorItem {
    public goods0: string = "";
    public goods1: string = "";
    public goodsJoint0: string = "";
    public goodsJoint1: string = "";
}

export class NPCDirector {
    private scratchNPCActorItem = new NPCActorItem();

    constructor(private npcDataArc: RARC.JKRArchive) {
    }

    public getNPCItemData(npcName: string, index: number, npcActorItem = this.scratchNPCActorItem): NPCActorItem | null {
        if (index === -1)
            return null;

        const infoIter = createCsvParser(this.npcDataArc.findFileData(`${npcName}Item.bcsv`)!);
        infoIter.setRecord(index);
        npcActorItem.goods0 = assertExists(infoIter.getValueString('mGoods0'));
        npcActorItem.goods1 = assertExists(infoIter.getValueString('mGoods1'));
        npcActorItem.goodsJoint0 = assertExists(infoIter.getValueString('mGoodsJoint0'));
        npcActorItem.goodsJoint1 = assertExists(infoIter.getValueString('mGoodsJoint1'));
        return npcActorItem;
    }
}

class NPCActor<TNerve extends number = number> extends LiveActor<TNerve> {
    public goods0: PartsModel | null = null;
    public goods1: PartsModel | null = null;

    public lastRotation = vec3.create();
    public poseQuat = quat.create();

    public waitAction: string | null = null;
    public walkAction: string | null = null;
    public desiredRailSpeed: number = 2.0;
    public maxChangeRailSpeed: number = 0.1;
    public railTurnSpeed: number = 0.08;
    public turnBckRate = 1.0;
    public railGrounded: boolean = false;

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (!vec3.equals(this.rotation, this.lastRotation)) {
            quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
            vec3.copy(this.lastRotation, this.rotation);
        }

        makeMtxTRFromActor(this.modelInstance!.modelMatrix, this);
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        calcGravity(sceneObjHolder, this);
        if (this.waitAction !== null) {
            startAction(this, this.waitAction);
            if (isBckExist(this, this.waitAction))
                startBckNoInterpole(this, this.waitAction);
            setBckFrameAtRandom(this);
            this.calcAndSetBaseMtx(sceneObjHolder, null!);
        }
    }

    protected equipment(sceneObjHolder: SceneObjHolder, itemGoods: NPCActorItem | null, isIndirect: boolean = false): void {
        if (itemGoods !== null) {
            if (isIndirect) {
                if (itemGoods.goods0)
                    this.goods0 = createNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
                if (itemGoods.goods1)
                    this.goods1 = createNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
            } else {
                if (itemGoods.goods0)
                    this.goods0 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
                if (itemGoods.goods1)
                    this.goods1 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
            }
        }
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        if (this.goods0 !== null)
            this.goods0.makeActorAppeared(sceneObjHolder);
        if (this.goods1 !== null)
            this.goods1.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        if (this.goods0 !== null)
            this.goods0.makeActorDead(sceneObjHolder);
        if (this.goods1 !== null)
            this.goods1.makeActorDead(sceneObjHolder);
    }
}

export class Butler extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Butler');
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        const location = getJMapInfoArg0(infoIter);

        startAction(this, 'Wait');
    }
}

export class Rosetta extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Rosetta');
        connectToSceneIndirectNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        startAction(this, 'WaitA');
    }
}

export class Tico extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Tico');
        connectToSceneIndirectNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        const color = fallback(getJMapInfoArg0(infoIter), -1);
        if (color !== -1) {
            startBrk(this, 'ColorChange');
            setBrkFrameAndStop(this, color);
        }

        startAction(this, 'Wait');
        setBckFrameAtRandom(this);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Tico');
    }
}

export class TicoAstro extends Tico {
    // TicoAstro checks current number of green stars against arg2 and shows/hides respectively...
}

const enum KinopioNrv { Wait }

export class Kinopio extends NPCActor<KinopioNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.set(this.scale, 1.2, 1.2, 1.2);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kinopio');
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(KinopioNrv.Wait);

        if (isConnectedWithRail(infoIter))
            this.initRailRider(sceneObjHolder, infoIter);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('Kinopio', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        this.waitAction = 'Wait';
        this.walkAction = 'Walk';
        this.railGrounded = true;
        this.desiredRailSpeed = 0.83;

        const arg2 = fallback(getJMapInfoArg2(infoIter), -1);
        if (arg2 === 0) {
            this.waitAction = `SpinWait1`;
        } else if (arg2 === 1) {
            this.waitAction = `SpinWait2`;
        } else if (arg2 === 2) {
            this.waitAction = `SpinWait3`;
        } else if (arg2 === 3) {
            // setDistanceToTalk
        } else if (arg2 === 4) {
            // MapObjConnector
            // setNerve(Mount);
        } else if (arg2 === 5) {
            this.waitAction = `SwimWait`;
            this.walkAction = `SwimWait`;
        } else if (arg2 === 6) {
            this.waitAction = `Pickel`;
        } else if (arg2 === 7) {
            this.waitAction = `Sleep`;
        } else if (arg2 === 8) {
            // this.hasTakeOutStar = true;
        } else if (arg2 === 9) {
            this.waitAction = `KinopioGoodsWeapon`;
            this.walkAction = `KinopioGoodsWeaponWalk`;
        } else if (arg2 === 10) {
            this.waitAction = `Joy`;
            this.walkAction = `Joy`;
        } else if (arg2 === 11) {
            this.waitAction = `Rightened`;
        } else if (arg2 === 12) {
            this.waitAction = `StarPieceWait`;
            this.walkAction = `KinopioGoodsStarPieceWalk`;
        } else if (arg2 === 13) {
            this.walkAction = `Getaway`;
            this.desiredRailSpeed = 3.32;
        } else if (arg2 === -1) {
            if (itemGoodsIdx === 2) {
                this.waitAction = `WaitPickel`;
                this.walkAction = `WalkPickel`;
            } else {
                // this.setNerve(KinopioNrv.Far);
            }
        }

        // Bind the color change animation.
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg1(infoIter), 0));

        // If we have an SW_APPEAR, then hide us until that switch triggers...
        if (fallback(infoIter.getValueNumber('SW_APPEAR'), -1) !== -1)
            this.makeActorDead(sceneObjHolder);

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KinopioNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KinopioNrv.Wait) {
            const nextRailPoint = isExistRail(this) ? getNextRailPointNo(this) : 0;

            // if (!tryStartReactionAndPushNerve(this))
            tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder, this, deltaTimeFrames);
            if (isExistRail(this) && getNextRailPointNo(this) !== nextRailPoint)
                this.tryStartArgs();
        }
    }

    private tryStartArgs(): void {
        // TODO(jstpierre): Rail point arg0.
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Kinopio');
        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

export class KinopioAstro extends Kinopio {
    // Toads living on the Astro Observatory. The game has some special casing for the mail toad,
    // but we don't need that too much here...
}

export class Peach extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.boundingSphereRadius = 100;

        startAction(this, 'Help');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

function decidePose(actor: NPCActor, up: vec3, front: vec3, pos: vec3, rotationSpeedUp: number, rotationSpeedFront: number, translationSpeed: number): void {
    vec3.lerp(actor.translation, actor.translation, pos, translationSpeed);
    if (vec3.equals(up, Vec3Zero))
        debugger;
    if (Number.isNaN(actor.poseQuat[0]))
        debugger;
    if (rotationSpeedUp === 1.0 && rotationSpeedFront === 1.0) {
        makeQuatUpFront(actor.poseQuat, up, front);
    } else {
        blendQuatUpFront(actor.poseQuat, actor.poseQuat, up, front, rotationSpeedUp, rotationSpeedFront);
    }
}

function followRailPose(actor: NPCActor, rotationSpeed: number, translationSpeed: number): void {
    getRailPos(scratchVec3a, actor);
    getRailDirection(scratchVec3b, actor);
    vec3.negate(scratchVec3c, actor.gravityVector);
    decidePose(actor, scratchVec3c, scratchVec3b, scratchVec3a, 1.0, rotationSpeed, translationSpeed);
}

function followRailPoseOnGround(sceneObjHolder: SceneObjHolder, actor: NPCActor, railActor: LiveActor, speed: number): void {
    getRailPos(scratchVec3a, railActor);
    vec3.scaleAndAdd(scratchVec3b, scratchVec3a, actor.gravityVector, -10.0);
    vec3.scale(scratchVec3c, actor.gravityVector, 1000.0);
    getFirstPolyOnLineToMap(sceneObjHolder, scratchVec3a, null, scratchVec3b, scratchVec3c);
    getRailDirection(scratchVec3b, actor);
    vec3.negate(scratchVec3c, actor.gravityVector);
    decidePose(actor, scratchVec3c, scratchVec3b, scratchVec3a, 1.0, speed, 1.0);
}

function startMoveAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    if (!isExistRail(actor))
        return;

    adjustmentRailCoordSpeed(actor, actor.desiredRailSpeed * deltaTimeFrames, actor.maxChangeRailSpeed);
    moveRailRider(actor);

    if (actor.railGrounded) {
        followRailPoseOnGround(sceneObjHolder, actor, actor, actor.railTurnSpeed * deltaTimeFrames);
    } else {
        followRailPose(actor, actor.railTurnSpeed * deltaTimeFrames, actor.railTurnSpeed * deltaTimeFrames);
    }

    if (isRailReachedGoal(actor))
        reverseRailDirection(actor);
}

function tryStartTurnAction(sceneObjHolder: SceneObjHolder, actor: NPCActor): void {
    if (actor.waitAction !== null)
        tryStartAction(actor, actor.waitAction);
}

function tryStartTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor): void {
    tryStartTurnAction(sceneObjHolder, actor);
}

function tryStartMoveTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    if (!isExistRail(actor)) {
        tryStartTalkAction(sceneObjHolder, actor);
        return;
    }

    if (isNearZero(actor.desiredRailSpeed, 0.001) && isNearZero(getRailCoordSpeed(actor), 0.001)) {
        tryStartTalkAction(sceneObjHolder, actor);
        return;
    }

    // Some stuff related to talking...
    startMoveAction(sceneObjHolder, actor, deltaTimeFrames);
    let action = actor.walkAction;

    if (action !== null)
        tryStartAction(actor, action);
}

function tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    tryStartMoveTalkAction(sceneObjHolder, actor, deltaTimeFrames);
    // tryTalkNearPlayer(actor);
}

class RemovableTurtle {
    public partsModel: PartsModel;
    // public jetTurtle: JetTurtle;

    constructor(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, isShiny: boolean) {
        if (isShiny) {
            this.partsModel = new PartsModel(sceneObjHolder, 'RemovableTurtle', 'KouraShiny', parentActor, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT);
        } else {
            this.partsModel = new PartsModel(sceneObjHolder, 'RemovableTurtle', 'Koura', parentActor, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT);

            // TODO(jstpierre): Where is this done?
            startBrk(this.partsModel, 'Koura');
            setBrkFrameAndStop(this.partsModel, 0);
        }

        // this.partsModel.isAttached = true;
        this.partsModel.initFixedPositionRelative(vec3.set(scratchVec3, -5.85, -68.0, 30.0));
        this.partsModel.makeActorDead(sceneObjHolder);
    }

    public tryAttach(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this.partsModel))
            this.partsModel.makeActorAppeared(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, isShiny: boolean): void {
        if (isShiny)
            sceneObjHolder.modelCache.requestObjectData('KouraShiny');
        else
            sceneObjHolder.modelCache.requestObjectData('Koura');
    }
}

const enum PenguinNrv { Wait, Dive }

export class Penguin extends NPCActor<PenguinNrv> {
    private mode: number;
    private diveCounter: number = 0;
    private removableTurtle: RemovableTurtle | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordAndTransToNearestRailPos(this);
        }

        this.mode = fallback(getJMapInfoArg0(infoIter), -1);
        if (this.mode === 4) {
            this.removableTurtle = new RemovableTurtle(sceneObjHolder, this, false);
            this.removableTurtle.tryAttach(sceneObjHolder);
        }

        if (this.mode === 0) {
            this.waitAction = `SitDown`;
        } else if (this.mode === 1) {
            this.waitAction = `SwimWait`;
            this.walkAction = `Swim`;
            this.desiredRailSpeed = 5.0;
        } else if (this.mode === 2) {
            this.waitAction = `SwimWaitSurface`;
            this.walkAction = `SwimSurface`;
            this.desiredRailSpeed = 5.0;
        } else if (this.mode === 3) {
            this.waitAction = `SwimWaitSurface`;
        } else if (this.mode === 4) {
            this.waitAction = `SwimTurtleTalk`;
            this.walkAction = `SwimTurtle`;
            this.desiredRailSpeed = 10.0;
        } else if (this.mode === 6) {
            this.waitAction = `Wait`;
            this.walkAction = `DashA`;
            this.desiredRailSpeed = 6.0;
            this.railTurnSpeed = 0.8;
            this.railGrounded = true;
        } else {
            this.waitAction = `Wait`;
            this.walkAction = `Walk`;
            this.desiredRailSpeed = 1.5;
            this.turnBckRate = 2.0;
            this.railGrounded = true;
        }

        setBckFrameAtRandom(this);

        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg7(infoIter), 0));

        this.initNerve(PenguinNrv.Wait);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        if (this.mode === 2 || this.mode === 3) {
            calcGravity(sceneObjHolder, this);
            vec3.negate(scratchVec3, this.gravityVector);
            turnQuatYDirRad(this.poseQuat, this.poseQuat, scratchVec3, MathConstants.TAU / 2);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PenguinNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PenguinNrv.Wait) {
            if (isFirstStep(this))
                this.diveCounter = getRandomInt(120, 300);

            tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder, this, deltaTimeFrames);

            if (this.mode === 3 && isGreaterStep(this, this.diveCounter))
                this.setNerve(PenguinNrv.Dive);
        } else if (currentNerve === PenguinNrv.Dive) {
            if (isFirstStep(this)) {
                startBck(this, `SwimDive`);
            }

            if (isBckStopped(this)) {
                // TODO(jstpierre): TalkCtrl
                startAction(this, `SwimWaitSurface`);
                this.setNerve(PenguinNrv.Wait);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);

        const arg0 = getJMapInfoArg0(infoIter);
        if (arg0 === 4)
            RemovableTurtle.requestArchives(sceneObjHolder, false);
    }
}

export class PenguinRacer extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "Penguin");
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(this.name, 0);
        this.equipment(sceneObjHolder, itemGoods);

        const arg7 = fallback(getJMapInfoArg7(infoIter), 0);
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, arg7);

        startAction(this, 'RacerWait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Penguin');
        requestArchivesForNPCGoods(sceneObjHolder, getObjectName(infoIter), 0);
    }
}

export class TicoComet extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = 0;
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('TicoComet', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        startAction(this.goods0!, 'LeftRotate');
        startAction(this.goods1!, 'RightRotate');

        startBtk(this, "TicoComet");
        startBva(this, "Small0");

        startBrk(this, 'Normal');
        setBrkFrameAndStop(this, 0);

        startAction(this, 'Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = 0;
        requestArchivesForNPCGoods(sceneObjHolder, 'TicoComet', itemGoodsIdx);
    }
}

export class SignBoard extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
    }
}
