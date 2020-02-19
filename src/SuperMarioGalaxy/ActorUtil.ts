
// Utilities for various actor implementations.

import { LiveActor, getJMapInfoTrans, getJMapInfoRotate, MessageType } from "./LiveActor";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { SceneObjHolder } from "./Main";
import { JMapInfoIter, getJMapInfoScale } from "./JMapInfo";
import { DrawType, DrawBufferType, CalcAnimType, MovementType, NameObj } from "./NameObj";
import { assertExists } from "../util";
import { BTIData, BTI } from "../Common/JSYSTEM/JUTTexture";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { getRes, XanimePlayer } from "./Animation";
import { vec3, vec2, mat4, quat } from "gl-matrix";
import { HitSensor } from "./HitSensor";
import { RailDirection } from "./RailRider";
import { isNearZero, isNearZeroVec3, MathConstants, normToLength, Vec3Zero } from "../MathHelpers";
import { Camera, texProjCameraSceneTex } from "../Camera";
import { NormalizedViewportCoords } from "../gfx/helpers/RenderTargetHelpers";
import { GravityInfo, GravityTypeMask } from "./Gravity";

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();
const scratchQuat = quat.create();

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

export function loadBTIData(sceneObjHolder: SceneObjHolder, arc: JKRArchive, filename: string): BTIData {
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

export function isActionStart(actor: LiveActor, action: string): boolean {
    if (actor.actorAnimKeeper !== null)
        return actor.actorAnimKeeper.isPlaying(actor, action);
    else
        return isBckPlaying(actor, action);
}

export function tryStartAction(actor: LiveActor, action: string): boolean {
    if (isActionStart(actor, action))
        return false;

    startAction(actor, action);
    return true;
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

export function isRailReachedGoal(actor: LiveActor): boolean {
    return actor.railRider!.isReachedGoal();
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

export function adjustmentRailCoordSpeed(actor: LiveActor, target: number, maxSpeed: number): void {
    const curSpeed = actor.railRider!.speed;

    if (Math.abs(curSpeed - target) >= maxSpeed) {
        if (target > curSpeed)
            target = curSpeed + maxSpeed;
        else if (target === curSpeed)
            target = curSpeed;
        else
            target = curSpeed - maxSpeed;
    }

    actor.railRider!.setSpeed(target);
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

export function calcDistanceToCurrentAndNextRailPoint(dst: vec2, actor: LiveActor): void {
    const railRider = actor.railRider!;

    const currCoord = railRider.coord;

    const currPointCoord = railRider.getCurrentPointCoord();
    if (isNearZero(currPointCoord, 0.001)) {
        if (railRider.direction === RailDirection.TOWARDS_START)
            dst[0] = railRider.getTotalLength() - currCoord;
        else
            dst[0] = currCoord;
    } else {
        dst[0] = Math.abs(currCoord - currPointCoord);
    }

    const nextPointCoord = railRider.getNextPointCoord();
    if (isNearZero(nextPointCoord, 0.001)) {
        if (railRider.direction === RailDirection.TOWARDS_START)
            dst[1] = currCoord;
        else
            dst[1] = railRider.getTotalLength() - currCoord;
    } else {
        dst[1] = Math.abs(nextPointCoord - currCoord);
    }
}

export function calcMtxAxis(axisX: vec3 | null, axisY: vec3 | null, axisZ: vec3 | null, m: mat4): void {
    if (axisX !== null)
        vec3.set(axisX, m[0], m[1], m[2]);
    if (axisY !== null)
        vec3.set(axisY, m[4], m[5], m[6]);
    if (axisZ !== null)
        vec3.set(axisZ, m[8], m[9], m[10]);
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

export function loadTexProjectionMtx(m: mat4, camera: Camera, viewport: NormalizedViewportCoords): void {
    texProjCameraSceneTex(m, camera, viewport, -1);
    mat4.mul(m, m, camera.viewMatrix);
}

export function setTextureMatrixST(m: mat4, scale: number, v: vec2 | null): void {
    mat4.identity(m);
    m[0] = scale;
    m[5] = scale;
    m[10] = scale;
    if (v !== null) {
        m[12] = v[0];
        m[13] = v[1];
    }
}

export function setTrans(dst: mat4, pos: vec3): void {
    dst[12] = pos[0];
    dst[13] = pos[1];
    dst[14] = pos[2];
    dst[15] = 1.0;
}

function calcGravityVectorOrZero(sceneObjHolder: SceneObjHolder, nameObj: NameObj, coord: vec3, gravityTypeMask: GravityTypeMask, dst: vec3, gravityInfo: GravityInfo | null = null, attachmentFilter: any = null): void {
    if (attachmentFilter === null)
        attachmentFilter = nameObj;

    sceneObjHolder.planetGravityManager!.calcTotalGravityVector(dst, gravityInfo, coord, gravityTypeMask, attachmentFilter);
}

export function calcGravityVector(sceneObjHolder: SceneObjHolder, nameObj: NameObj, coord: vec3, dst: vec3, gravityInfo: GravityInfo | null = null, attachmentFilter: any = null): void {
    // Can't import GravityTypeMask without circular dependencies... TODO(jstpierre): Change this.
    const GravityTypeMask_Normal = 0x01;
    calcGravityVectorOrZero(sceneObjHolder, nameObj, coord, GravityTypeMask_Normal, dst, gravityInfo, attachmentFilter);
}

export function calcGravity(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    calcGravityVector(sceneObjHolder, actor, actor.translation, scratchVec3);
    if (!isNearZeroVec3(scratchVec3, 0.001))
        vec3.copy(actor.gravityVector, scratchVec3);
}

export function makeMtxTRFromQuatVec(dst: mat4, q: quat, translation: vec3): void {
    mat4.fromQuat(dst, q);
    dst[12] = translation[0];
    dst[13] = translation[1];
    dst[14] = translation[2];
}

export function setMtxAxisXYZ(dst: mat4, x: vec3, y: vec3, z: vec3): void {
    dst[0] = x[0];
    dst[1] = x[1];
    dst[2] = x[2];
    dst[3] = 0.0;
    dst[4] = y[0];
    dst[5] = y[1];
    dst[6] = y[2];
    dst[7] = 0.0;
    dst[8] = z[0];
    dst[9] = z[1];
    dst[10] = z[2];
    dst[11] = 0.0;
}

export function makeMtxFrontUpPos(dst: mat4, front: vec3, up: vec3, pos: vec3): void {
    const frontNorm = scratchVec3a;
    const upNorm = scratchVec3b;
    const right = scratchVec3c;
    vec3.normalize(frontNorm, front);
    vec3.cross(right, up, frontNorm);
    vec3.normalize(right, right);
    vec3.cross(upNorm, frontNorm, right);
    setMtxAxisXYZ(dst, right, upNorm, frontNorm);
    setTrans(dst, pos);
}

export function makeMtxUpFrontPos(dst: mat4, up: vec3, front: vec3, pos: vec3): void {
    const upNorm = scratchVec3b;
    const frontNorm = scratchVec3a;
    const right = scratchVec3c;
    vec3.normalize(upNorm, up);
    vec3.cross(right, up, front);
    vec3.normalize(right, right);
    vec3.cross(frontNorm, right, upNorm);
    setMtxAxisXYZ(dst, right, upNorm, frontNorm);
    setTrans(dst, pos);
}

export function makeQuatUpFront(dst: quat, up: vec3, front: vec3): void {
    makeMtxUpFrontPos(scratchMatrix, up, front, Vec3Zero);
    mat4.getRotation(dst, scratchMatrix);
    quat.normalize(dst, dst);
}

export function quatSetRotate(q: quat, v0: vec3, v1: vec3, t: number, scratch = scratchVec3): void {
    // v0 and v1 are normalized.

    // TODO(jstpierre): There's probably a better way to do this that doesn't involve an atan2.
    vec3.cross(scratchVec3, v0, v1);
    const sin = vec3.length(scratchVec3);
    if (sin > MathConstants.EPSILON) {
        const cos = vec3.dot(v0, v1);
        const theta = Math.atan2(sin, cos);
        quat.setAxisAngle(q, scratchVec3, theta * t);
    } else {
        quat.identity(q);
    }
}

export function quatGetAxisX(dst: vec3, q: quat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = (1.0 - 2.0 * y * y) - 2.0 * z * z;
    dst[1] = 2.0 * x * y + 2.0 * w * z;
    dst[2] = 2.0 * x * z - 2.0 * w * y;
}

export function quatGetAxisY(dst: vec3, q: quat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = 2.0 * x * y - 2.0 * w * z;
    dst[1] = (1.0 - 2.0 * x * x) - 2.0 * z * z;
    dst[2] = 2.0 * y * z + 2.0 * w * x;
}

export function quatGetAxisZ(dst: vec3, q: quat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = 2.0 * x * z + 2.0 * w * y;
    dst[1] = 2.0 * y * z - 2.0 * x * w;
    dst[2] = (1.0 - 2.0 * x * x) - 2.0 * y * y;
}

export function isSameDirection(v0: vec3, v1: vec3, ep: number): boolean {
    if (Math.abs(v0[1] * v1[2] - v0[2] * v1[1]) > ep)
        return false;
    if (Math.abs(v0[2] * v1[0] - v0[0] * v1[2]) > ep)
        return false;
    if (Math.abs(v0[0] * v1[1] - v0[1] * v1[0]) > ep)
        return false;
    return true;
}

export function addRandomVector(dst: vec3, src: vec3, mag: number): void {
    dst[0] = src[0] + getRandomFloat(-mag, mag);
    dst[1] = src[1] + getRandomFloat(-mag, mag);
    dst[2] = src[2] + getRandomFloat(-mag, mag);
}

export function turnRandomVector(dst: vec3, src: vec3, mag: number): void {
    if (isNearZero(vec3.length(src), 0.001)) {
        vec3.copy(dst, src);
    } else {
        addRandomVector(dst, src, mag);
        normToLength(dst, mag);
    }
}

export function blendQuatUpFront(dst: quat, q: quat, up: vec3, front: vec3, speedUp: number, speedFront: number): void {
    const axisY = scratchVec3a;
    const axisZ = scratchVec3b;
    const scratch = scratchVec3;

    quatGetAxisY(axisY, q);
    if (vec3.dot(axisY, up) < 0.0 && isSameDirection(axisY, up, 0.01))
        turnRandomVector(axisY, axisY, 0.001);
    quatSetRotate(scratchQuat, axisY, up, speedUp, scratch);
    quat.mul(dst, scratchQuat, q);

    quatGetAxisY(axisY, dst);
    vec3.scaleAndAdd(axisY, front, axisY, -vec3.dot(axisY, front));
    vec3.normalize(axisY, axisY);

    quatGetAxisZ(axisZ, dst);
    if (vec3.dot(axisZ, axisY) < 0.0 && isSameDirection(axisZ, axisY, 0.01))
        turnRandomVector(axisZ, axisZ, 0.001);

    quatSetRotate(scratchQuat, axisZ, axisY, speedFront, scratch);
    quat.mul(dst, scratchQuat, dst);
    quat.normalize(dst, dst);
}
