
// Misc actors that aren't big enough to have their own file.

import { LightType } from './DrawBuffer';
import { SceneObjHolder, LiveActor, ZoneAndLayer, getObjectName, SMGPass, startBtkIfExist, startBvaIfExist, WorldmapPointInfo, startBrkIfExist, getDeltaTimeFrames, getTimeFrames, startBck, startBpkIfExist } from './smg_scenes';
import { createCsvParser, JMapInfoIter, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoArg4, getJMapInfoArg6, getJMapInfoArg7 } from './JMapInfo';
import { mat4, vec3 } from 'gl-matrix';
import AnimationController from '../../AnimationController';
import { MathConstants, computeModelMatrixSRT, clamp } from '../../MathHelpers';
import { colorNewFromRGBA8, Color } from '../../Color';
import { ColorKind } from '../../gx/gx_render';
import { BTK, BRK, LoopMode } from '../j3d';
import * as Viewer from '../../viewer';
import * as RARC from '../../j3d/rarc';
import { DrawBufferType, MovementType, CalcAnimType, DrawType } from './NameObj';
import { BMDModelInstance } from '../render';
import { assertExists } from '../../util';
import { Camera } from '../../Camera';
import { isGreaterStep, isFirstStep, calcNerveRate } from './Spine';

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
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.NPC_INDIRECT, -1);
}

export function connectToSceneItemStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x2C, 0x10, 0x0F, -1);
}

export function connectToSceneCollisionMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, 0x0A, -1);
}

export function connectToSceneCollisionMapObjWeakLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, 0x09, -1);
}

export function connectToSceneCollisionMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, 0x08, -1);
}

export function connectToSceneMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, 0x08, -1);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, 0x0D, -1);
}

export function connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, 0x0F, -1);
}

export function connectToSceneSky(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x24, 0x05, DrawBufferType.SKY, -1);
}

export function connectToSceneAir(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x24, 0x05, DrawBufferType.AIR, -1);
}

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    const bloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x1E, -2, -2);
    bloomModel.modelInstance.passMask = SMGPass.BLOOM;
    return bloomModel;
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x08, -2, -2);
}

export function emitEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    actor.effectKeeper.createEmitter(sceneObjHolder, name);
}

export function setEffectEnvColor(actor: LiveActor, name: string, color: Color): void {
    const emitter = actor.effectKeeper.getEmitter(name);
    emitter.setGlobalEnvColor(color, -1);
}

export function deleteEffect(actor: LiveActor, name: string): void {
    actor.effectKeeper.deleteEmitter(name);
}

export function deleteEffectAll(actor: LiveActor): void {
    actor.effectKeeper.deleteEmitterAll();
}

export function hideModel(actor: LiveActor): void {
    actor.visibleModel = false;
}

export function showModel(actor: LiveActor): void {
    actor.visibleModel = true;
}

export function calcUpVec(v: vec3, actor: LiveActor): void {
    const mtx = actor.getBaseMtx();
    vec3.set(v, mtx[4], mtx[5], mtx[6]);
}

export function getCamPos(v: vec3, camera: Camera): void {
    const m = camera.worldMatrix;
    vec3.set(v, m[12], m[13], m[14]);
}

export function getCamYdir(v: vec3, camera: Camera): void {
    camera.getWorldUp(v);
}

export function calcSqDistanceToPlayer(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.squaredDistance(actor.translation, scratch);
}

export function calcDistanceToPlayer(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.distance(actor.translation, scratch);
}

export function scaleMatrixScalar(m: mat4, s: number): void {
    m[0] *= s;
    m[4] *= s;
    m[8] *= s;
    m[1] *= s;
    m[5] *= s;
    m[9] *= s;
    m[2] *= s;
    m[6] *= s;
    m[10] *= s;
}

// ClippingJudge has these distances.
const clippingJudgeDistances = [
    -1, 60000, 50000, 40000, 30000, 20000, 10000, 5000,
];

// Mapping from "far clipping" values to the actual distances.
function setClippingFar(f: number): number {
    if (f === -1)
        return 0;
    if (f === 50)
        return 7;
    if (f === 100)
        return 6;
    if (f === 200)
        return 5;
    if (f === 300)
        return 4;
    if (f === 400)
        return 3;
    if (f === 500)
        return 2;
    if (f === 600)
        return 1;
    throw "whoops";
}

function bindColorChangeAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, frame: number, brkName: string = 'colorchange.brk'): void {
    const animationController = new AnimationController();
    animationController.setTimeInFrames(frame);

    const brk = BRK.parse(assertExists(arc.findFileData(brkName)));
    modelInstance.bindTRK1(brk.trk1, animationController);
}

class MapObjActorInitInfo {
    public lightType: LightType = LightType.Planet;
    public initLightControl: boolean = false;
}

class MapObjActor extends LiveActor {
    private bloomModel: ModelObj | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, initInfo: MapObjActorInitInfo) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.connectToScene(sceneObjHolder, initInfo);
        if (initInfo.initLightControl)
            this.initLightCtrl(sceneObjHolder);

        const bloomObjName = `${this.name}Bloom`;
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomObjName)) {
            this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, this.name, bloomObjName, this.modelInstance.modelMatrix);
        }
    }

    public connectToScene(sceneObjHolder: SceneObjHolder, initInfo: MapObjActorInitInfo): void {
        // Default implementation.
        if (initInfo.lightType === LightType.Strong)
            connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);
        else if (initInfo.lightType === LightType.Weak)
            connectToSceneCollisionMapObjWeakLight(sceneObjHolder, this);
        else
            connectToSceneCollisionMapObj(sceneObjHolder, this);
    }
}

export class CollapsePlane extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
    }
}

export class ModelObj extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private transformMatrix: mat4 | null, drawBufferType: DrawBufferType, movementType: MovementType, calcAnimType: CalcAnimType) {
        super(zoneAndLayer, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (this.transformMatrix !== null)
            mat4.getTranslation(this.translation, this.transformMatrix);
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.transformMatrix !== null) {
            mat4.getTranslation(this.translation, this.transformMatrix);
            mat4.copy(this.modelInstance.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(viewerInput);
        }
    }
}

const starPieceColorTable = [
    colorNewFromRGBA8(0x7F7F00FF),
    colorNewFromRGBA8(0x800099FF),
    colorNewFromRGBA8(0xE7A000FF),
    colorNewFromRGBA8(0x46A108FF),
    colorNewFromRGBA8(0x375AA0FF),
    colorNewFromRGBA8(0xBE330BFF),
    colorNewFromRGBA8(0x808080FF),
];

export class StarPiece extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        let starPieceColorIndex = getJMapInfoArg3(infoIter, -1);
        if (starPieceColorIndex < 0 || starPieceColorIndex > 5)
            starPieceColorIndex = ((Math.random() * 6.0) | 0) + 1;

        this.modelInstance.setColorOverride(ColorKind.MAT0, starPieceColorTable[starPieceColorIndex]);

        const animationController = new AnimationController();
        animationController.setTimeInFrames(5);
        this.modelInstance.bindTTK1(BTK.parse(this.arc.findFileData(`Gift.btk`)).ttk1, animationController);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        // The star piece rotates around the Y axis at 15 degrees every frame.
        const enum Constants {
            SPEED = MathConstants.DEG_TO_RAD * 15,
        }

        this.rotation[1] += getDeltaTimeFrames(viewerInput) * Constants.SPEED;
        super.calcAndSetBaseMtx(viewerInput);
    }
}

export class EarthenPipe extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "EarthenPipe");

        const colorFrame = getJMapInfoArg7(infoIter, 0);
        const animationController = new AnimationController();
        animationController.setTimeInFrames(colorFrame);
        this.modelInstance.bindTRK1(BRK.parse(this.arc.findFileData(`EarthenPipe.brk`)).trk1, animationController);

        connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);

        const isHidden = getJMapInfoArg2(infoIter, 0);
        if (isHidden !== 0)
            this.modelInstance.visible = false;
    }
}

function setXYZDir(dst: mat4, x: vec3, y: vec3, z: vec3): void {
    dst[0] = x[0];
    dst[1] = x[1];
    dst[2] = x[2];
    dst[3] = 9999;
    dst[4] = y[0];
    dst[5] = y[1];
    dst[6] = y[2];
    dst[7] = 9999;
    dst[8] = z[0];
    dst[9] = z[1];
    dst[10] = z[2];
    dst[11] = 9999;
}

const scratchVec3 = vec3.create();
function makeMtxFrontUpPos(dst: mat4, front: vec3, up: vec3, pos: vec3): void {
    vec3.normalize(front, front);
    vec3.cross(scratchVec3, front, up);
    vec3.normalize(scratchVec3, scratchVec3);
    setXYZDir(dst, scratchVec3, up, front);
    dst[12] = pos[0];
    dst[13] = pos[1];
    dst[14] = pos[2];
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class BlackHole extends LiveActor {
    private blackHoleModel: ModelObj;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'BlackHoleRange');
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.blackHoleModel = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'BlackHole', 'BlackHole', this.modelInstance.modelMatrix);
        this.initEffectKeeper(sceneObjHolder, 'BlackHoleRange');

        startBck(this, `BlackHoleRange`);
        startBtkIfExist(this.modelInstance, this.arc, `BlackHoleRange`);
        startBtkIfExist(this.blackHoleModel.modelInstance, this.blackHoleModel.arc, `BlackHole`);

        let rangeScale: number;
        const arg0 = getJMapInfoArg0(infoIter, -1);
        if (arg0 < 0) {
            // If this is a cube, we behave slightly differently wrt. scaling.
            if (this.name !== 'BlackHoleCube')
                rangeScale = infoIter.getValueNumber('scale_x');
            else
                rangeScale = 1.0;
        } else {
            rangeScale = arg0 / 1000.0;
        }

        this.updateModelScale(rangeScale, rangeScale);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(viewerInput);

        const front = scratchVec3a;
        const up = scratchVec3b;

        getCamPos(front, viewerInput.camera);
        vec3.sub(front, front, this.translation);
        getCamYdir(up, viewerInput.camera);
        makeMtxFrontUpPos(scratchMatrix, front, up, this.translation);
        scaleMatrixScalar(scratchMatrix, this.scale[0]);
        this.effectKeeper.setSRTFromHostMtx(scratchMatrix);
    }

    private updateModelScale(rangeScale: number, holeScale: number): void {
        vec3.set(this.scale, rangeScale, rangeScale, rangeScale);
        vec3.set(this.blackHoleModel.scale, 0.5 * holeScale, 0.5 * holeScale, 0.5 * holeScale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(`BlackHole`);
        sceneObjHolder.modelCache.requestObjectData(`BlackHoleRange`);
    }
}

function createSubModelObjName(parentActor: LiveActor, suffix: string): string {
    return `${parentActor.name}${suffix}`;
}

function createSubModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, suffix: string, drawBufferType: DrawBufferType): PartsModel {
    const subModelObjName = createSubModelObjName(parentActor, suffix);
    const model = new PartsModel(sceneObjHolder, subModelObjName, subModelObjName, parentActor, drawBufferType);
    model.tryStartAllAnim(subModelObjName);
    return model;
}

function createIndirectPlanetModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    const model = createSubModel(sceneObjHolder, parentActor, 'Indirect', 0x1D);
    model.modelInstance.passMask = SMGPass.INDIRECT;
    return model;
}

export class PeachCastleGardenPlanet extends MapObjActor {
    private indirectModel: PartsModel | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);
        this.tryStartAllAnim('Before');
        this.tryStartAllAnim('PeachCastleGardenPlanet');
    }

    public connectToScene(sceneObjHolder: SceneObjHolder): void {
        // won't this check always fail for PeachCastleGardenPlanet?
/*
        if (isExistIndirectTexture(this) === 0)
            registerNameObjToExecuteHolder(this, 0x1D, 0x01, 0x04, -1);
        else
            registerNameObjToExecuteHolder(this, 0x1D, 0x01, 0x1D, -1);
*/
        connectToScene(sceneObjHolder, this, 0x1D, 0x01, 0x04, -1);
    }
}

class FixedPosition {
    private localTrans = vec3.create();

    constructor(private baseMtx: mat4, localTrans: vec3 | null = null) {
        if (localTrans !== null)
            this.setLocalTrans(localTrans);
    }

    public setLocalTrans(localTrans: vec3): void {
        vec3.copy(this.localTrans, localTrans);
    }

    public calc(dst: mat4): void {
        mat4.copy(dst, this.baseMtx);
        mat4.translate(dst, dst, this.localTrans);
    }
}

class PartsModel extends LiveActor {
    public fixedPosition: FixedPosition | null = null;

    constructor(sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private parentActor: LiveActor, drawBufferType: DrawBufferType) {
        super(parentActor.zoneAndLayer, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        this.initEffectKeeper(sceneObjHolder, null);

        let movementType: MovementType = 0x2B;
        let calcAnimType: CalcAnimType = 0x0B;
        if (drawBufferType >= 0x15 && drawBufferType <= 0x18) {
            movementType = 0x26;
            calcAnimType = 0x0A;
        } else if (drawBufferType === 0x10 || drawBufferType === 0x1B) {
            movementType = 0x28;
            calcAnimType = 0x06;
        }

        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public initFixedPositionRelative(localTrans: vec3 | null): void {
        this.fixedPosition = new FixedPosition(this.parentActor.modelInstance.modelMatrix, localTrans);
    }

    public initFixedPositionJoint(jointName: string, localTrans: vec3 | null): void {
        this.fixedPosition = new FixedPosition(this.parentActor.getJointMtx(jointName), localTrans);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.fixedPosition !== null)
            this.fixedPosition.calc(this.modelInstance.modelMatrix);
    }
}

function createPartsModelIndirectNpc(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC_INDIRECT);
    model.modelInstance.passMask = SMGPass.INDIRECT;
    model.initFixedPositionJoint(jointName, localTrans);
    return model;
}

function createIndirectNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = createPartsModelIndirectNpc(sceneObjHolder, parentActor, objName, jointName, localTrans);
    model.initLightCtrl(sceneObjHolder);
    return model;
}

function createPartsModelNpcAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC);
    model.initFixedPositionJoint(jointName, localTrans);
    return model;
}

function createPartsModelNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, 0x0D);
    model.initFixedPositionRelative(localTrans);
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
    public goods0: string | null;
    public goods1: string | null;
    public goodsJoint0: string | null;
    public goodsJoint1: string | null;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.goods0 = null;
        this.goods1 = null;
        this.goodsJoint0 = null;
        this.goodsJoint1 = null;
    }
}

export class NPCDirector {
    private scratchNPCActorItem = new NPCActorItem();

    constructor(private npcDataArc: RARC.RARC) {
    }

    public getNPCItemData(npcName: string, index: number, npcActorItem = this.scratchNPCActorItem): NPCActorItem | null {
        if (index === -1)
            return null;

        const infoIter = createCsvParser(this.npcDataArc.findFileData(`${npcName}Item.bcsv`));
        infoIter.setRecord(index);
        npcActorItem.goods0 = infoIter.getValueString('mGoods0');
        npcActorItem.goods1 = infoIter.getValueString('mGoods1');
        npcActorItem.goodsJoint0 = infoIter.getValueString('mGoodsJoint0');
        npcActorItem.goodsJoint1 = infoIter.getValueString('mGoodsJoint1');
        return npcActorItem;
    }
}

class NPCActor extends LiveActor {
    public goods0: PartsModel | null = null;
    public goods1: PartsModel | null = null;

    protected equipment(sceneObjHolder: SceneObjHolder, itemGoods: NPCActorItem, isIndirect: boolean = false): void {
        if (itemGoods === null)
            return;

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

export class Kinopio extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        const objName = this.name;
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = getJMapInfoArg7(infoIter);
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('Kinopio', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        const arg2 = getJMapInfoArg2(infoIter);
        if (arg2 === 0) {
            this.startAction(`SpinWait1`);
        } else if (arg2 === 1) {
            this.startAction(`SpinWait2`);
        } else if (arg2 === 2) {
            this.startAction(`SpinWait3`);
        } else if (arg2 === 3) {
            this.startAction(`Wait`);
        } else if (arg2 === 4) {
            this.startAction(`Wait`);
        } else if (arg2 === 5) {
            this.startAction(`SwimWait`);
        } else if (arg2 === 6) {
            this.startAction(`Pickel`);
        } else if (arg2 === 7) {
            this.startAction(`Sleep`);
        } else if (arg2 === 8) {
            this.startAction(`Wait`);
        } else if (arg2 === 9) {
            this.startAction(`KinopioGoodsWeapon`);
        } else if (arg2 === 10) {
            this.startAction(`Joy`);
        } else if (arg2 === 11) {
            this.startAction(`Rightened`);
        } else if (arg2 === 12) {
            this.startAction(`StarPieceWait`);
        } else if (arg2 === 13) {
            this.startAction(`Getaway`);
        } else if (arg2 === -1) {
            if (itemGoodsIdx === 2) {
                this.startAction(`WaitPickel`);
            } else {
                this.startAction(`Wait`);
            }
        }

        // Bind the color change animation.
        bindColorChangeAnimation(this.modelInstance, this.arc, getJMapInfoArg1(infoIter, 0));

        // If we have an SW_APPEAR, then hide us until that switch triggers...
        if (infoIter.getValueNumber('SW_APPEAR') !== -1)
            this.makeActorDead();
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = getJMapInfoArg7(infoIter);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

export class Peach extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        const objName = this.name;
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.boundingSphereRadius = 100;

        this.startAction('Help');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = getJMapInfoArg7(infoIter);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

export class Penguin extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        const objName = this.name;
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.boundingSphereRadius = 100;

        const arg0 = getJMapInfoArg0(infoIter, -1);
        if (arg0 === 0) {
            this.startAction(`SitDown`);
        } else if (arg0 === 1) {
            this.startAction(`SwimWait`);
        } else if (arg0 === 2) {
            this.startAction(`SwimWaitSurface`);
        } else if (arg0 === 3) {
            this.startAction(`SwimWaitSurface`);
        } else if (arg0 === 4) {
            this.startAction(`SwimTurtleTalk`);
        } else if (arg0 === 6) {
            this.startAction(`Wait`);
        } else {
            this.startAction(`Wait`);
        }

        // Bind the color change animation.
        bindColorChangeAnimation(this.modelInstance, this.arc, getJMapInfoArg7(infoIter, 0));
    }
}

export class PenguinRacer extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "Penguin");
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.boundingSphereRadius = 100;

        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(this.name, 0);
        this.equipment(sceneObjHolder, itemGoods);

        const arg7 = getJMapInfoArg7(infoIter, 0);
        bindColorChangeAnimation(this.modelInstance, this.arc, arg7);
        this.startAction('RacerWait');

        // Bind the color change animation.
        bindColorChangeAnimation(this.modelInstance, this.arc, getJMapInfoArg7(infoIter, 0));
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        requestArchivesForNPCGoods(sceneObjHolder, getObjectName(infoIter), 0);
    }
}

export class TicoComet extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        const objName = this.name;
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = 0;
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('TicoComet', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        this.goods0.startAction('LeftRotate');
        this.goods1.startAction('RightRotate');

        startBtkIfExist(this.modelInstance, this.arc, "TicoComet");
        startBvaIfExist(this.modelInstance, this.arc, "Small0");

        // TODO(jstpierre): setBrkFrameAndStop
        bindColorChangeAnimation(this.modelInstance, this.arc, 0, "Normal.brk");

        this.startAction('Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = 0;
        requestArchivesForNPCGoods(sceneObjHolder, 'TicoComet', itemGoodsIdx);
    }
}

const scratchMatrix = mat4.create();
export class Coin extends LiveActor {
    private airBubble: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, getObjectName(infoIter));
        connectToSceneItemStrongLight(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        const isNeedBubble = getJMapInfoArg7(infoIter);
        if (isNeedBubble !== -1) {
            this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble", vec3.fromValues(0, 70, 0));
            this.airBubble.tryStartAllAnim("Move");
        }

        this.tryStartAllAnim('Move');
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        // TODO(jstpierre): CoinRotater has three separate matrices:
        //   - getCoinRotateYMatrix()
        //   - getCoinInWaterRotateYMatrix()
        //   - getCoinHiSpeedRotateYMatrix()
        // for now we just spin at 4 degrees per frame lol

        const enum Constants {
            SPEED = MathConstants.DEG_TO_RAD * 4,
        };

        const rotationY = getTimeFrames(viewerInput) * Constants.SPEED;
        computeModelMatrixSRT(scratchMatrix, 1, 1, 1, 0, rotationY, 0, 0, 0, 0);
        super.calcAndSetBaseMtx(viewerInput);
        mat4.mul(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, scratchMatrix);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const isNeedBubble = getJMapInfoArg7(infoIter);
        if (isNeedBubble !== -1)
            sceneObjHolder.modelCache.requestObjectData("AirBubble");
    }
}

export class MiniRoutePoint extends LiveActor {
    private miniature: MiniRouteMiniature | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, 'MiniRoutePoint');
        this.initModelManagerWithAnm(sceneObjHolder, 'MiniRoutePoint');
        vec3.copy(this.translation, pointInfo.position);

        this.tryStartAllAnim('Open');
        if (pointInfo.isPink)
            startBrkIfExist(this.modelInstance, this.arc, 'TicoBuild');
        else
            startBrkIfExist(this.modelInstance, this.arc, 'Normal');

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        if (pointInfo.miniatureName !== null)
            this.miniature = new MiniRouteMiniature(sceneObjHolder, this, pointInfo);
    }
}

class MiniRouteMiniature extends PartsModel {
    private rotateSpeed = 0;

    constructor(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, pointInfo: WorldmapPointInfo) {
        super(sceneObjHolder, pointInfo.miniatureName, pointInfo.miniatureName, parentActor, 0x0D);
        this.initFixedPositionRelative(pointInfo.miniatureOffset);

        if (pointInfo.miniatureType == 'Galaxy' || pointInfo.miniatureType == 'MiniGalaxy')
            this.rotateSpeed = 0.25 * MathConstants.DEG_TO_RAD;

        this.startAction(this.name);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(viewerInput);

        const rotateY = getTimeFrames(viewerInput) * this.rotateSpeed;
        mat4.rotateY(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, rotateY);
    }
}

export class SimpleEffectObj extends LiveActor {
    private isVisible: boolean = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));
        this.initDefaultPos(sceneObjHolder, infoIter);

        if (sceneObjHolder.effectSystem === null)
            return;

        this.initEffectKeeper(sceneObjHolder, this.name);
        emitEffect(sceneObjHolder, this, this.name);

        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    protected getClippingRadius(): number {
        return 500;
    }

    protected getFarClipDistance(): number {
        return 50;
    }

    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 0, 0);
    }

    protected isSyncClipping(): boolean {
        return false;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.getClippingCenterOffset(scratchVec3);
        vec3.add(scratchVec3, this.translation, scratchVec3);

        const visibleScenario = this.visibleScenario && this.visibleAlive;
        let visible = visibleScenario;

        const camera = viewerInput.camera;
        if (visible)
            visible = camera.frustum.containsSphere(scratchVec3, this.getClippingRadius());

        if (this.isVisible === visible)
            return;

        this.isVisible = visible;
        this.effectKeeper.setDrawParticle(visible);

        if (this.isSyncClipping()) {
            if (visible)
                emitEffect(sceneObjHolder, this, this.name);
            else
                deleteEffectAll(this);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        // Don't need anything, effectSystem is already built-in.
    }
}

export class EffectObjR1000F50 extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 1000;
    }
}

export class EffectObj10x10x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 580, 0);
    }

    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class EffectObj20x20x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 200, 0);
    }

    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class EffectObj50x50x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 200, 0);
    }

    protected getClippingRadius(): number {
        return 2500;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class GCaptureTarget extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "GCaptureTarget");
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        startBck(this, 'Wait');
        bindColorChangeAnimation(this.modelInstance, this.arc, 1, 'Switch.brk');

        this.effectKeeper.createEmitter(sceneObjHolder, 'TargetLight');
        this.effectKeeper.createEmitter(sceneObjHolder, 'TouchAble');
    }
}

const enum FountainBigNrv {
    WAIT_PHASE, WAIT, SIGN, SIGN_STOP, SPOUT, SPOUT_END
}

export class FountainBig extends LiveActor {
    private upVec = vec3.create();
    private randomPhase: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "FountainBig");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        calcUpVec(this.upVec, this);
        vec3.scaleAndAdd(this.upVec, this.translation, this.upVec, 300);

        hideModel(this);
        startBtkIfExist(this.modelInstance, this.arc, "FountainBig");

        // TODO(jstpierre): Figure out what causes this phase for realsies. Might just be culling...
        this.randomPhase = (Math.random() * 300) | 0;

        this.initNerve(FountainBigNrv.WAIT_PHASE);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();

        if (currentNerve === FountainBigNrv.WAIT_PHASE) {
            if (isGreaterStep(this, this.randomPhase)) {
                this.setNerve(FountainBigNrv.WAIT);
                return;
            }
        } else if (currentNerve === FountainBigNrv.WAIT) {
            if (isGreaterStep(this, 120)) {
                this.setNerve(FountainBigNrv.SIGN);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SIGN) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'FountainBigSign');

            if (isGreaterStep(this, 80)) {
                this.setNerve(FountainBigNrv.SIGN_STOP);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SIGN_STOP) {
            if (isFirstStep(this))
                deleteEffect(this, 'FountainBigSign');

            if (isGreaterStep(this, 30)) {
                this.setNerve(FountainBigNrv.SPOUT);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SPOUT) {
            if (isFirstStep(this)) {
                showModel(this);
                emitEffect(sceneObjHolder, this, 'FountainBig');
            }

            const t = calcNerveRate(this, 20);
            if (t <= 1) {
                this.scale[1] = clamp(t, 0.01, 1);
            }

            if (isGreaterStep(this, 180)) {
                deleteEffect(this, 'FountainBig');
                this.setNerve(FountainBigNrv.SPOUT_END);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SPOUT_END) {
            const t = 1 - calcNerveRate(this, 10);
            this.scale[1] = clamp(t, 0.01, 1);

            if (isGreaterStep(this, 10)) {
                hideModel(this);
                this.setNerve(FountainBigNrv.WAIT);
                return;
            }
        }
    }
}

export class AstroEffectObj extends SimpleEffectObj {
    // The game will check whether the user has the correct dome enabled,
    // but it is otherwise identical to SimpleEffectObj.
}

const warpPodColorTable = [
    colorNewFromRGBA8(0x0064C8FF),
    colorNewFromRGBA8(0x2CFF2AFF),
    colorNewFromRGBA8(0xFF3C3CFF),
    colorNewFromRGBA8(0xC4A600FF),
    colorNewFromRGBA8(0x00FF00FF),
    colorNewFromRGBA8(0xFF00FFFF),
    colorNewFromRGBA8(0xFFFF00FF),
    colorNewFromRGBA8(0xFFFFFFFF),
];

export class WarpPod extends LiveActor {
    private visible: boolean;
    private colorIndex: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WarpPod");

        this.visible = !!getJMapInfoArg1(infoIter, 0);
        const hasSaveFlag = !!getJMapInfoArg3(infoIter, 0);
        const astroDomeNum = !!getJMapInfoArg4(infoIter, 0);
        this.colorIndex = getJMapInfoArg6(infoIter, 0);

        if (this.visible) {
            connectToScene(sceneObjHolder, this, 0x22, 5, 8, -1);
        } else {
            connectToScene(sceneObjHolder, this, 0x22, -1, -1, -1);
        }

        this.initEffectKeeper(sceneObjHolder, null);

        if (this.visible) {
            startBck(this, 'Active');
            startBrkIfExist(this.modelInstance, this.arc, 'Active');
            // This is a bit hokey, but we don't have an XanimePlayer, so this is our solution...
            this.modelInstance.ank1Animator.ank1.loopMode = LoopMode.ONCE;
        }

        // The game normally will check a few different save file bits
        // or the highest unlocked AstroDome, but we just declare all
        // WarpPods are active.
        const inactive = false;

        if (inactive) {
            startBck(this, 'Wait');
            startBrkIfExist(this.modelInstance, this.arc, 'Wait');
        } else {
            this.glowEffect(sceneObjHolder);
        }
    }

    private glowEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.visible) {
            emitEffect(sceneObjHolder, this, 'EndGlow');
            setEffectEnvColor(this, 'EndGlow', warpPodColorTable[this.colorIndex]);
        }
    }
}

export class AstroCountDownPlate extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "AstroCountDownPlate");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        emitEffect(sceneObjHolder, this, "Light");

        startBrkIfExist(this.modelInstance, this.arc, "Green");
    }
}

export class Butler extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Butler');
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        const location = getJMapInfoArg0(infoIter);

        this.startAction('Wait');
    }
}

export class Rosetta extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Rosetta');
        connectToSceneIndirectNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.startAction('WaitA');

        // "Rosetta Encounter" -- she looks dim without this.
        // Total hack.
        this.actorLightCtrl.setAreaLightFromName(sceneObjHolder, `ロゼッタ出会い`);
    }
}

export class Tico extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Tico');
        connectToSceneIndirectNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        const color = getJMapInfoArg0(infoIter, -1);
        if (color !== -1) {
            bindColorChangeAnimation(this.modelInstance, this.arc, color);
        }

        this.startAction('Wait');
        this.modelInstance.animationController.phaseFrames += Math.random() * 1000;
    }
}

export class Sky extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneSky(sceneObjHolder, this);

        this.modelInstance.passMask = SMGPass.SKYBOX;
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAnim(sceneObjHolder, viewerInput);
        getCamPos(this.translation, viewerInput.camera);
    }
}

const enum AirState {
    IN, OUT,
}

export class Air extends LiveActor {
    private distInThresholdSq: number;
    private distOutThresholdSq: number;
    private state: AirState = AirState.IN;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneAir(sceneObjHolder, this);

        let thresholdParam = getJMapInfoArg0(infoIter, -1);
        if (thresholdParam < 0)
            thresholdParam = 70;

        const distInThreshold = 100 * thresholdParam;
        this.distInThresholdSq = distInThreshold*distInThreshold;
        const distOutThreshold = 100 * (20 + thresholdParam);
        this.distOutThresholdSq = distOutThreshold*distOutThreshold;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const distanceToPlayer = calcSqDistanceToPlayer(this, viewerInput.camera);
        if (this.state === AirState.OUT && distanceToPlayer < this.distInThresholdSq) {
            this.tryStartAllAnim('Appear');
            this.modelInstance.animationController.setPhaseToCurrent();
            this.state = AirState.IN;
        } else if (this.state === AirState.IN && distanceToPlayer > this.distOutThresholdSq) {
            this.tryStartAllAnim('Disappear');
            this.modelInstance.animationController.setPhaseToCurrent();
            this.state = AirState.OUT;
        }
    }
}

const enum ShootingStarNrv {
    PRE_SHOOTING, SHOOTING, WAIT_FOR_NEXT_SHOOT,
}

export class ShootingStar extends LiveActor {
    private delay: number;
    private distance: number;
    private axisY = vec3.create();
    private initialTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneMapObj(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        vec3.copy(this.initialTranslation, this.translation);

        const numStarBits = getJMapInfoArg0(infoIter, 5);
        this.delay = getJMapInfoArg1(infoIter, 240);
        this.distance = getJMapInfoArg2(infoIter, 2000);

        calcUpVec(this.axisY, this);

        this.initNerve(ShootingStarNrv.PRE_SHOOTING);
        this.initEffectKeeper(sceneObjHolder, 'ShootingStar');

        startBpkIfExist(this.modelInstance, this.arc, 'ShootingStar');
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();

        if (currentNerve === ShootingStarNrv.PRE_SHOOTING) {
            if (isFirstStep(this)) {
                vec3.scaleAndAdd(this.translation, this.initialTranslation, this.axisY, this.distance);
                showModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarAppear');
            }

            const scale = calcNerveRate(this, 20);
            vec3.set(this.scale, scale, scale, scale);

            if (isGreaterStep(this, 20)) {
                this.setNerve(ShootingStarNrv.SHOOTING);
            }
        } else if (currentNerve === ShootingStarNrv.SHOOTING) {
            if (isFirstStep(this)) {
                vec3.negate(this.velocity, this.axisY);
                vec3.scale(this.velocity, this.velocity, 25);
                emitEffect(sceneObjHolder, this, 'ShootingStarBlur');
            }

            if (isGreaterStep(this, 360)) {
                this.setNerve(ShootingStarNrv.WAIT_FOR_NEXT_SHOOT);
                deleteEffect(this, 'ShootingStarBlur');
            }
        } else if (currentNerve === ShootingStarNrv.WAIT_FOR_NEXT_SHOOT) {
            if (isFirstStep(this)) {
                hideModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarBreak');
                vec3.set(this.velocity, 0, 0, 0);
            }

            if (isGreaterStep(this, this.delay)) {
                this.setNerve(ShootingStarNrv.PRE_SHOOTING);
            }
        }
    }
}
