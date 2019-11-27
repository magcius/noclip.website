
// Utilities for various actor implementations.

import { LiveActor, getJMapInfoTrans, getJMapInfoRotate, MessageType } from "./LiveActor";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { SceneObjHolder } from "./Main";
import { JMapInfoIter, getJMapInfoScale } from "./JMapInfo";
import { DrawType, DrawBufferType, CalcAnimType, MovementType, NameObj } from "./NameObj";
import { assertExists } from "../util";
import { BTIData, BTI } from "../Common/JSYSTEM/JUTTexture";
import { RARC } from "../j3d/rarc";
import { getRes, XanimePlayer } from "./Animation";
import { vec3 } from "gl-matrix";
import { HitSensor } from "./HitSensor";
import { RailDirection } from "./RailRider";

const scratchVec3 = vec3.create();

export function connectToScene(sceneObjHolder: SceneObjHolder, nameObj: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, movementType, calcAnimType, drawBufferType, drawType);
}

export function connectToSceneMapObjMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, -1, -1, -1);
}

export function connectToSceneNpc(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x28, 0x06, DrawBufferType.NPC, -1);
}

export function connectToSceneIndirectNpc(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x28, 0x06, DrawBufferType.INDIRECT_NPC, -1);
}

export function connectToSceneItem(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x2C, 0x10, DrawBufferType.NO_SILHOUETTED_MAP_OBJ, -1);
}

export function connectToSceneItemStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x2C, 0x10, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x1E, 0x02, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjWeakLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x1E, 0x02, DrawBufferType.MAP_OBJ_WEAK_LIGHT, -1);
}

export function connectToSceneCollisionMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x1E, 0x02, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObjNoCalcAnim(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, -1, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneIndirectMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ, -1);
}

export function connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneSky(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x24, 0x05, DrawBufferType.SKY, -1);
}

export function connectToSceneAir(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x24, 0x05, DrawBufferType.AIR, -1);
}

export function connectToSceneCrystal(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.CRYSTAL, -1);
}

export function connectToSceneBloom(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    // TODO(jstpierre): Verify
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x22, 0x05, DrawBufferType.BLOOM_MODEL, -1);
}

export function connectToScenePlanet(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (isExistIndirectTexture(actor))
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1D, 0x01, DrawBufferType.INDIRECT_PLANET, -1);
    else 
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1D, 0x01, DrawBufferType.PLANET, -1);
}

export function connectToSceneEnvironment(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x21, 0x04, DrawBufferType.ENVIRONMENT, -1);
}

export function connectToSceneEnvironmentStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x21, 0x04, DrawBufferType.ENVIRONMENT_STRONG_LIGHT, -1);
}

export function connectToSceneEnemyMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x2A, -1, -1, -1);
}

export function connectToSceneScreenEffectMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, 0x03, -1, -1, -1);
}

export function isBckStopped(actor: LiveActor): boolean {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    // TODO(jstpierre): Add stopped flags?
    return bckCtrl.speedInFrames === 0.0;
}

export function getBckFrameMax(actor: LiveActor): number {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    return bckCtrl.endFrame;
}

// TODO(jstpierre): Remove.
export function setLoopMode(actor: LiveActor, loopMode: LoopMode): void {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    bckCtrl.loopMode = loopMode;
}

export function initDefaultPos(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): void {
    if (infoIter !== null) {
        getJMapInfoTrans(actor.translation, sceneObjHolder, infoIter);
        getJMapInfoRotate(actor.rotation, sceneObjHolder, infoIter);
        getJMapInfoScale(actor.scale, infoIter);
    }
}

export function isExistIndirectTexture(actor: LiveActor): boolean {
    const modelInstance = assertExists(actor.modelInstance);
    if (modelInstance.getTextureMappingReference('IndDummy') !== null)
        return true;
    return false;
}

export function loadBTIData(sceneObjHolder: SceneObjHolder, arc: RARC, filename: string): BTIData {
    const device = sceneObjHolder.modelCache.device;
    const cache = sceneObjHolder.modelCache.cache;

    const buffer = arc.findFileData(filename);
    const btiData = new BTIData(device, cache, BTI.parse(buffer!, filename).texture);
    return btiData;
}

export function isBckExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.motionTable, name) !== null;
}

export function isBtkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.btkTable, name) !== null;
}

export function isBrkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.brkTable, name) !== null;
}

export function isBtpExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.btpTable, name) !== null;
}

export function isBpkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.bpkTable, name) !== null;
}

export function isBvaExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.bvaTable, name) !== null;
}

export function tryStartBck(actor: LiveActor, name: string): boolean {
    if (!isBckPlaying(actor, name)) {
        actor.modelManager!.startBck(name);
        if (actor.effectKeeper !== null)
            actor.effectKeeper.changeBck();
        return true;
    } else {
        return false;
    }
}

export function startBck(actor: LiveActor, name: string): void {
    actor.modelManager!.startBck(name);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck();
}

export function startBckWithInterpole(actor: LiveActor, name: string, interpole: number): void {
    actor.modelManager!.startBckWithInterpole(name, interpole);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck();
}

export function startBtk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBtk(name);
}

export function startBrk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBrk(name);
}

export function startBtp(actor: LiveActor, name: string): void {
    actor.modelManager!.startBtp(name);
}

export function startBpk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBpk(name);
}

export function startBva(actor: LiveActor, name: string): void {
    actor.modelManager!.startBva(name);
}

export function startBckIfExist(actor: LiveActor, name: string): boolean {
    const bck = actor.resourceHolder.getRes(actor.resourceHolder.motionTable, name);
    if (bck !== null) {
        actor.modelManager!.startBck(name);
        if (actor.effectKeeper !== null)
            actor.effectKeeper.changeBck();
    }
    return bck !== null;
}

export function startBtkIfExist(actor: LiveActor, name: string): boolean {
    const btk = actor.resourceHolder.getRes(actor.resourceHolder.btkTable, name);
    if (btk !== null)
        actor.modelManager!.startBtk(name);
    return btk !== null;
}

export function startBrkIfExist(actor: LiveActor, name: string): boolean {
    const brk = actor.resourceHolder.getRes(actor.resourceHolder.brkTable, name);
    if (brk !== null)
        actor.modelManager!.startBrk(name);
    return brk !== null;
}

export function startBpkIfExist(actor: LiveActor, name: string): boolean {
    const bpk = actor.resourceHolder.getRes(actor.resourceHolder.bpkTable, name);
    if (bpk !== null)
        actor.modelManager!.startBpk(name);
    return bpk !== null;
}

export function startBtpIfExist(actor: LiveActor, name: string): boolean {
    const btp = actor.resourceHolder.getRes(actor.resourceHolder.btpTable, name);
    if (btp !== null)
        actor.modelManager!.startBtp(name);
    return btp !== null;
}

export function startBvaIfExist(actor: LiveActor, name: string): boolean {
    const bva = actor.resourceHolder.getRes(actor.resourceHolder.bvaTable, name);
    if (bva !== null)
        actor.modelManager!.startBva(name);
    return bva !== null;
}

export function setBckFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBckFrame(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = frame;
}

export function setBckFrameAtRandom(actor: LiveActor): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = getRandomFloat(0, ctrl.endFrame);
}

export function setBckRate(actor: LiveActor, rate: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.speedInFrames = rate;
}

export function setBtkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBtkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBrkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBrkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBtpFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBtpCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBpkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBpkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBvaFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBvaCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function isBckPlayingXanimePlayer(xanimePlayer: XanimePlayer, name: string): boolean {
    // TODO(jstpierre): Support stopped flag?
    return xanimePlayer.isRun(name) && xanimePlayer.frameCtrl.speedInFrames !== 0.0;
}

export function isBckOneTimeAndStopped(actor: LiveActor): boolean {
    return actor.modelManager!.isBckStopped();
}

export function isBckPlaying(actor: LiveActor, name: string): boolean {
    return isBckPlayingXanimePlayer(actor.modelManager!.xanimePlayer!, name);
}

export function isBtkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBtkPlaying(name);
}

export function isBrkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBrkPlaying(name);
}

export function isBtpPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBtpPlaying(name);
}

export function isBpkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBpkPlaying(name);
}

export function isBvaPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBvaPlaying(name);
}

export function startAction(actor: LiveActor, animationName: string): void {
    if (actor.actorAnimKeeper === null || !actor.actorAnimKeeper.start(actor, animationName))
        tryStartAllAnim(actor, animationName);
}

export function tryStartAllAnim(actor: LiveActor, animationName: string): boolean {
    let anyPlayed = false;
    anyPlayed = startBckIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBtkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBrkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBpkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBtpIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBvaIfExist(actor, animationName) || anyPlayed;
    return anyPlayed;
}

export function getRandomFloat(min: number, max: number): number {
    return ((Math.random() * (max - min)) + min);
}

export function getRandomInt(min: number, max: number): number {
    return getRandomFloat(min, max) | 0;
}

export function addHitSensorNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: vec3): void {
    actor.hitSensorKeeper!.add(sceneObjHolder, name, 0x05, pairwiseCapacity, radius, actor, offset);
}

export function receiveMessage(thisSensor: HitSensor, messageType: MessageType, otherSensor: HitSensor): boolean {
    return thisSensor.actor.receiveMessage(messageType, thisSensor, otherSensor);
}

export function sendArbitraryMsg(messageType: MessageType, otherSensor: HitSensor, thisSensor: HitSensor): boolean {
    return receiveMessage(otherSensor, messageType, thisSensor);
}

export function getRailTotalLength(actor: LiveActor): number {
    return actor.railRider!.getTotalLength();
}

export function getRailDirection(dst: vec3, actor: LiveActor): void {
    vec3.copy(dst, actor.railRider!.currentDir);
}

export function getRailCoordSpeed(actor: LiveActor): number {
    return actor.railRider!.speed;
}

export function calcRailPosAtCoord(dst: vec3, actor: LiveActor, coord: number): void {
    actor.railRider!.calcPosAtCoord(dst, coord);
}

export function isRailGoingToEnd(actor: LiveActor): boolean {
    return actor.railRider!.direction === RailDirection.TOWARDS_END;
}

export function reverseRailDirection(actor: LiveActor): void {
    actor.railRider!.reverse();
}

export function isLoopRail(actor: LiveActor): boolean {
    return actor.railRider!.isLoop();
}

export function moveCoordToStartPos(actor: LiveActor): void {
    actor.railRider!.setCoord(0);
}

export function setRailCoordSpeed(actor: LiveActor, v: number): void {
    actor.railRider!.setSpeed(Math.abs(v));
}

export function moveCoordAndTransToNearestRailPos(actor: LiveActor): void {
    actor.railRider!.moveToNearestPos(actor.translation);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoordAndTransToNearestRailPoint(actor: LiveActor): void {
    actor.railRider!.moveToNearestPoint(actor.translation);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoordAndTransToRailStartPoint(actor: LiveActor): void {
    actor.railRider!.setCoord(0);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoord(actor: LiveActor, speed: number): void {
    actor.railRider!.setSpeed(speed);
    actor.railRider!.move();
}

export function moveCoordAndFollowTrans(actor: LiveActor, speed: number): void {
    moveCoord(actor, speed);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function getCurrentRailPointNo(actor: LiveActor): number {
    return actor.railRider!.currentPointId;
}

export function getRailPartLength(actor: LiveActor, partIdx: number): number {
    return actor.railRider!.getPartLength(partIdx);
}

export function getRailCoord(actor: LiveActor): number {
    return actor.railRider!.coord;
}

export function getRailPos(v: vec3, actor: LiveActor): void {
    vec3.copy(v, actor.railRider!.currentPos);
}

export function setRailCoord(actor: LiveActor, coord: number): void {
    actor.railRider!.setCoord(coord);
}

export function moveRailRider(actor: LiveActor): void {
    actor.railRider!.move();
}

export function isExistRail(actor: LiveActor): boolean {
    return actor.railRider !== null;
}

export function getRailPointPosStart(actor: LiveActor): vec3 {
    return actor.railRider!.startPos;
}

export function getRailPointPosEnd(actor: LiveActor): vec3 {
    return actor.railRider!.endPos;
}

export function getRailPointNum(actor: LiveActor): number {
    return actor.railRider!.getPointNum();
}

export function calcRailPointPos(dst: vec3, actor: LiveActor, i: number): void {
    actor.railRider!.copyPointPos(dst, i);
}

export function moveTransToOtherActorRailPos(actor: LiveActor, otherActor: LiveActor): void {
    getRailPos(actor.translation, otherActor);
}

export function calcDistanceVertical(actor: LiveActor, other: vec3): number {
    vec3.subtract(scratchVec3, actor.translation, other);
    const m = vec3.dot(actor.gravityVector, scratchVec3);
    vec3.scale(scratchVec3, actor.gravityVector, m);
    return vec3.length(scratchVec3);
}

export function isValidDraw(actor: LiveActor): boolean {
    return actor.visibleAlive && actor.visibleScenario;
}
