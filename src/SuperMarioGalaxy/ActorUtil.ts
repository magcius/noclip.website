
// Utilities for various actor implementations.

import { LiveActor, getJMapInfoTrans, getJMapInfoRotate } from "./LiveActor";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { SceneObjHolder } from "./Main";
import { JMapInfoIter, getJMapInfoScale } from "./JMapInfo";
import { DrawType, DrawBufferType, CalcAnimType, MovementType } from "./NameObj";
import { assertExists } from "../util";
import { BTIData, BTI } from "../Common/JSYSTEM/JUTTexture";
import { RARC } from "../j3d/rarc";
import { getRes } from "./Animation";

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

export function connectToScene(sceneObjHolder: SceneObjHolder, actor: LiveActor, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, movementType, calcAnimType, drawBufferType, drawType);
}

export function connectToSceneMapObjMovement(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, -1, -1, -1);
}

export function connectToSceneNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.NPC, -1);
}

export function connectToSceneIndirectNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.INDIRECT_NPC, -1);
}

export function connectToSceneItem(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x2C, 0x10, DrawBufferType.NO_SILHOUETTED_MAP_OBJ, -1);
}

export function connectToSceneItemStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x2C, 0x10, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjWeakLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ_WEAK_LIGHT, -1);
}

export function connectToSceneCollisionMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObjNoCalcAnim(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, -1, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneIndirectMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ, -1);
}

export function connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneSky(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x24, 0x05, DrawBufferType.SKY, -1);
}

export function connectToSceneAir(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x24, 0x05, DrawBufferType.AIR, -1);
}

export function connectToSceneCrystal(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.CRYSTAL, -1);
}

export function connectToSceneBloom(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    // TODO(jstpierre): Verify
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x22, 0x05, DrawBufferType.BLOOM_MODEL, -1);
}

export function connectToScenePlanet(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (isExistIndirectTexture(actor))
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1D, 0x01, DrawBufferType.INDIRECT_PLANET, -1);
    else 
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x1D, 0x01, DrawBufferType.PLANET, -1);
}

export function connectToSceneEnvironment(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x21, 0x04, DrawBufferType.ENVIRONMENT, -1);
}

export function connectToSceneEnvironmentStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x21, 0x04, DrawBufferType.ENVIRONMENT_STRONG_LIGHT, -1);
}

export function connectToSceneEnemyMovement(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x2A, -1, -1, -1);
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

export function startBck(actor: LiveActor, name: string): void {
    actor.modelManager!.startBck(name);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck(name);
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
            actor.effectKeeper.changeBck(name);
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

export function isBckPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBckPlaying(name);
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
