
// Misc actors that aren't big enough to have their own file.

import { LightType } from './DrawBuffer';
import { SceneObjHolder, LiveActor, ZoneAndLayer, getObjectName, SMGPass, startBckIfExist, startBtkIfExist, startBvaIfExist, WorldmapPointInfo, startBrkIfExist } from './smg_scenes';
import { JMapInfoIter, getJMapInfoArg3, getJMapInfoArg2, getJMapInfoArg7, getJMapInfoArg0, getJMapInfoArg1, createCsvParser } from './JMapInfo';
import { mat4, vec3 } from 'gl-matrix';
import AnimationController from '../../AnimationController';
import { MathConstants, computeModelMatrixSRT } from '../../MathHelpers';
import { colorNewFromRGBA8 } from '../../Color';
import { ColorKind } from '../../gx/gx_render';
import { BTK, BRK } from '../j3d';
import * as Viewer from '../../viewer';
import * as RARC from '../../j3d/rarc';
import { DrawBufferType, MovementType, CalcAnimType, DrawType } from './NameObj';
import { BMDModelInstance } from '../render';
import { assertExists } from '../../util';

export function connectToScene(sceneObjHolder: SceneObjHolder, actor: LiveActor, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, movementType, calcAnimType, drawBufferType, drawType);
}

export function connectToSceneNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.NPC, -1);
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

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    const bloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x1E, -2, -2);
    bloomModel.modelInstance.passMask = SMGPass.BLOOM;
    return bloomModel;
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x08, -2, -2);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, 0x0D, -1);
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

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        // TODO(jstpierre): Don't depend on the modelInstance for initDefaultPos.
        this.initDefaultPos(sceneObjHolder, infoIter);
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
    private spinAnimationController = new AnimationController(60);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        this.initDefaultPos(sceneObjHolder, infoIter);

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

        this.spinAnimationController.setTimeFromViewerInput(viewerInput);
        const timeInFrames = this.spinAnimationController.getTimeInFrames();
        this.rotation[1] = timeInFrames * Constants.SPEED;
        super.calcAndSetBaseMtx(viewerInput);
    }
}

export class EarthenPipe extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, "EarthenPipe");
        this.initDefaultPos(sceneObjHolder, infoIter);

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

export class BlackHole extends LiveActor {
    private blackHoleModel: ModelObj;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, 'BlackHoleRange');
        this.initDefaultPos(sceneObjHolder, infoIter);
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.blackHoleModel = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'BlackHole', 'BlackHole', this.modelInstance.modelMatrix);

        startBckIfExist(this.modelInstance, this.arc, `BlackHoleRange`);
        startBtkIfExist(this.modelInstance, this.arc, `BlackHoleRange`);
        startBtkIfExist(this.blackHoleModel.modelInstance, this.blackHoleModel.arc, `BlackHole`);

        let rangeScale: number;
        const arg0 = getJMapInfoArg0(infoIter, -1);
        if (arg0 < 0) {
            // If this is a cube, we behave slightly differently wrt. scaling.
            if (getObjectName(infoIter) !== 'BlackHoleCube')
                rangeScale = infoIter.getValueNumber('scale_x');
            else
                rangeScale = 1.0;
        } else {
            rangeScale = arg0 / 1000.0;
        }

        this.updateModelScale(rangeScale, rangeScale);
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
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

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
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

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
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

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

        this.initModelManagerWithAnm(sceneObjHolder, "Penguin");
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

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
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initLightCtrl(sceneObjHolder);

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
    private spinAnimationController = new AnimationController(60);
    private airBubble: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, getObjectName(infoIter));
        connectToSceneItemStrongLight(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        this.initDefaultPos(sceneObjHolder, infoIter);

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

        this.spinAnimationController.setTimeFromViewerInput(viewerInput);
        const timeInFrames = this.spinAnimationController.getTimeInFrames();
        const rotationY = timeInFrames * Constants.SPEED;
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
    private spinAnimationController = new AnimationController(60);

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

        this.spinAnimationController.setTimeFromViewerInput(viewerInput);
        const timeInFrames = this.spinAnimationController.getTimeInFrames();
        mat4.rotateY(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, this.rotateSpeed * timeInFrames);
    }
}
