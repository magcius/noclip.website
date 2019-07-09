
// Misc actors that aren't big enough to have their own file.

import { LightType } from './DrawBuffer';
import { SceneObjHolder, LiveActor, ZoneAndLayer, getObjectName, startBtkIfExist, startBvaIfExist, WorldmapPointInfo, startBrkIfExist, getDeltaTimeFrames, getTimeFrames, startBck, startBpkIfExist, startBtpIfExist, NameObjFactory } from './smg_scenes';
import { createCsvParser, JMapInfoIter, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoArg4, getJMapInfoArg6, getJMapInfoArg7 } from './JMapInfo';
import { mat4, vec3 } from 'gl-matrix';
import AnimationController from '../../AnimationController';
import { MathConstants, computeModelMatrixSRT, clamp } from '../../MathHelpers';
import { colorNewFromRGBA8, Color } from '../../Color';
import { ColorKind } from '../../gx/gx_render';
import { BTK, BRK, LoopMode, BTP } from '../j3d';
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
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x28, 0x06, DrawBufferType.INDIRECT_NPC, -1);
}

export function connectToSceneItemStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, 0x2C, 0x10, DrawBufferType.NO_SILHOUETTED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneCollisionMapObjWeakLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ_WEAK_LIGHT, -1);
}

export function connectToSceneCollisionMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x1E, 0x02, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.MAP_OBJ, -1);
}

export function connectToSceneMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneIndirectMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.INDIRECT_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ, -1);
}

export function connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.NO_SHADOWED_MAP_OBJ_STRONG_LIGHT, -1);
}

export function connectToSceneSky(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x24, 0x05, DrawBufferType.SKY, -1);
}

export function connectToSceneAir(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x24, 0x05, DrawBufferType.AIR, -1);
}

export function connectToSceneCrystal(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.CRYSTAL, -1);
}

export function connectToSceneBloom(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    // TODO(jstpierre): Verify
    connectToScene(sceneObjHolder, actor, 0x22, 0x05, DrawBufferType.BLOOM_MODEL, -1);
}

export function connectToScenePlanet(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (isExistIndirectTexture(actor))
        connectToScene(sceneObjHolder, actor, 0x1D, 0x01, DrawBufferType.INDIRECT_PLANET, -1);
    else 
        connectToScene(sceneObjHolder, actor, 0x1D, 0x01, DrawBufferType.PLANET, -1);
}

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    const bloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.BLOOM_MODEL, -2, -2);
    return bloomModel;
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, 0x08, -2, -2);
}

export function emitEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.createEmitter(sceneObjHolder, name);
}

export function setEffectEnvColor(actor: LiveActor, name: string, color: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = actor.effectKeeper.getEmitter(name);
    emitter.setGlobalEnvColor(color, -1);
}

export function deleteEffect(actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.deleteEmitter(name);
}

export function deleteEffectAll(actor: LiveActor): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.deleteEmitterAll();
}

export function isRegisteredEffect(actor: LiveActor, name: string): boolean {
    if (actor.effectKeeper === null)
        return false;
    return actor.effectKeeper.isRegisteredEmitter(name);
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

export function isExistIndirectTexture(actor: LiveActor): boolean {
    const modelInstance = assertExists(actor.modelInstance);
    if (modelInstance.getTextureMappingReference('IndDummy') !== null)
        return true;
    return false;
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

export function bindColorChangeAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, frame: number, baseName: string = 'ColorChange'): void {
    const brkName = `${baseName}.brk`;
    if (arc.findFile(brkName) !== null) {
        const animationController = new AnimationController();
        animationController.setTimeInFrames(frame);

        const brk = BRK.parse(assertExists(arc.findFileData(brkName)));
        modelInstance.bindTRK1(brk.trk1, animationController);
    }
}

export function bindTexChangeAnimation(modelInstance: BMDModelInstance, arc: RARC.RARC, frame: number, baseName: string = 'TexChange'): void {
    const btpName = `${baseName}.btp`;
    const btkName = `${baseName}.btp`;

    const animationController = new AnimationController();
    animationController.setTimeInFrames(frame);

    if (arc.findFile(btpName) !== null) {
        const btp = BTP.parse(assertExists(arc.findFileData(btpName)));
        modelInstance.bindTPT1(btp.tpt1, animationController);
    }

    if (arc.findFile(btkName) !== null) {
        const btk = BTK.parse(assertExists(arc.findFileData(btkName)));
        modelInstance.bindTTK1(btk.ttk1, animationController);
    }
}

function createSubModelObjName(parentActor: LiveActor, suffix: string): string {
    return `${parentActor.name}${suffix}`;
}

function createSubModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, suffix: string, drawBufferType: DrawBufferType): PartsModel | null {
    const subModelObjName = createSubModelObjName(parentActor, suffix);
    if (!sceneObjHolder.modelCache.isObjectDataExist(subModelObjName))
        return null;
    const model = new PartsModel(sceneObjHolder, subModelObjName, subModelObjName, parentActor, drawBufferType);
    model.initFixedPositionRelative(null);
    model.tryStartAllAnim(subModelObjName);
    return model;
}

function createWaterModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    const model = createSubModel(sceneObjHolder, parentActor, 'Water', DrawBufferType.MAP_OBJ);
    return model;
}

function createIndirectPlanetModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    const model = createSubModel(sceneObjHolder, parentActor, 'Indirect', DrawBufferType.INDIRECT_PLANET);
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

function createPartsModelNpcAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.NPC);
    model.initFixedPositionJoint(jointName, localTrans);
    return model;
}

function createPartsModelMapObj(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.MAP_OBJ);
    model.initFixedPositionRelative(localTrans);
    return model;
}

function createPartsModelNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.NO_SILHOUETTED_MAP_OBJ);
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

function setupInitInfoSimpleMapObj(initInfo: MapObjActorInitInfo): void {
    initInfo.setupDefaultPos = true;
    initInfo.connectToScene = true;
    initInfo.initEffect = true;
    initInfo.effectFilename = null;
}

function setupInitInfoTypical(initInfo: MapObjActorInitInfo, objName: string): void {
    // Special cases go here.
}

function setupInitInfoColorChangeArg0(initInfo: MapObjActorInitInfo, infoIter: JMapInfoIter): void {
    initInfo.colorChangeFrame = getJMapInfoArg0(infoIter, -1);
}

function setupInitInfoTextureChangeArg1(initInfo: MapObjActorInitInfo, infoIter: JMapInfoIter): void {
    initInfo.texChangeFrame = getJMapInfoArg1(infoIter, -1);
}

function setupInitInfoPlanet(initInfo: MapObjActorInitInfo): void {
    initInfo.setupDefaultPos = true;
    initInfo.connectToScene = true;
    initInfo.initEffect = true;
    initInfo.effectFilename = null;
}

class MapObjActorInitInfo {
    public lightType: LightType = LightType.Planet;
    public initLightControl: boolean = false;
    public connectToScene: boolean = false;
    public setupDefaultPos: boolean = true;
    public modelName: string | null = null;
    public initEffect: boolean = false;
    public effectFilename: string | null = null;
    public colorChangeFrame: number = -1;
    public texChangeFrame: number = -1;

    public setupConnectToScene(): void {
        this.connectToScene = true;
    }

    public setupModelName(name: string): void {
        this.modelName = name;
    }

    public setupEffect(name: string): void {
        this.initEffect = true;
        this.effectFilename = name;
    }
}

class MapObjActor extends LiveActor {
    private bloomModel: ModelObj | null = null;
    private objName: string;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, initInfo: MapObjActorInitInfo) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.objName = this.name;
        if (initInfo.modelName !== null)
            this.objName = initInfo.modelName;

        if (initInfo.setupDefaultPos)
            this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.objName);
        if (initInfo.connectToScene)
            this.connectToScene(sceneObjHolder, initInfo);
        if (initInfo.initLightControl)
            this.initLightCtrl(sceneObjHolder);
        if (initInfo.initEffect !== null)
            this.initEffectKeeper(sceneObjHolder, initInfo.effectFilename);

        if (initInfo.colorChangeFrame !== -1)
            bindColorChangeAnimation(this.modelInstance, this.arc, initInfo.colorChangeFrame);

        if (initInfo.texChangeFrame !== -1)
            bindTexChangeAnimation(this.modelInstance, this.arc, initInfo.texChangeFrame);

        const bloomObjName = `${this.objName}Bloom`;
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomObjName)) {
            this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, this.name, bloomObjName, this.modelInstance.modelMatrix);
        }
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

    public isObjectName(name: string): boolean {
        return this.objName === name;
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

export class PlanetMap extends LiveActor {
    private bloomModel: ModelObj | null = null;
    private waterModel: PartsModel | null = null;
    private indirectModel: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModel(sceneObjHolder, this.name, infoIter);
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.tryStartAllAnim(this.name);
    }

    private initModel(sceneObjHolder: SceneObjHolder, name: string, infoIter: JMapInfoIter): void {
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.initBloomModel(sceneObjHolder, name);

        this.waterModel = createWaterModel(sceneObjHolder, this);
        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);
    }

    private initBloomModel(sceneObjHolder: SceneObjHolder, name: string): void {
        const bloomModelName = `${name}Bloom`;
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomModelName)) {
            this.bloomModel = createModelObjBloomModel(this.zoneAndLayer, sceneObjHolder, this.name, bloomModelName, this.getBaseMtx());
            vec3.copy(this.bloomModel.scale, this.scale);
        }
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

export class CollapsePlane extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        initInfo.setupConnectToScene();
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);
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
    private pipeStream: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "EarthenPipe");

        const colorFrame = getJMapInfoArg7(infoIter, 0);
        const animationController = new AnimationController();
        animationController.setTimeInFrames(colorFrame);
        this.modelInstance.bindTRK1(BRK.parse(this.arc.findFileData(`EarthenPipe.brk`)).trk1, animationController);

        connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        const isHidden = getJMapInfoArg2(infoIter, 0);
        if (isHidden !== 0)
            hideModel(this);

        if (this.name === "EarthenPipeInWater") {
            this.pipeStream = createPartsModelMapObj(sceneObjHolder, this, "EarthenPipeStream");
            this.pipeStream.tryStartAllAnim("EarthenPipeStream");
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("EarthenPipe");

        if (getObjectName(infoIter) === "EarthenPipeInWater")
            sceneObjHolder.modelCache.requestObjectData("EarthenPipeStream");
    }
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

        if (this.effectKeeper !== null) {
            const front = scratchVec3a;
            const up = scratchVec3b;

            getCamPos(front, viewerInput.camera);
            vec3.sub(front, front, this.translation);
            getCamYdir(up, viewerInput.camera);
            makeMtxFrontUpPos(scratchMatrix, front, up, this.translation);
            scaleMatrixScalar(scratchMatrix, this.scale[0]);
            this.effectKeeper.setSRTFromHostMtx(scratchMatrix);
        }
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

export class PeachCastleGardenPlanet extends MapObjActor {
    private indirectModel: PartsModel | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        setupInitInfoPlanet(initInfo);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);
        this.tryStartAllAnim('Before');
        this.tryStartAllAnim('PeachCastleGardenPlanet');
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder): void {
        connectToScenePlanet(sceneObjHolder, this);
    }
}

export class HatchWaterPlanet extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'HatchWaterPlanet');
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.tryStartAllAnim('HatchWaterPlanet');
        this.modelInstance.ank1Animator.ank1.loopMode = LoopMode.ONCE;
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
        bindColorChangeAnimation(this.modelInstance, this.arc, 0, "Normal");

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
    }
}

export class MiniRouteGalaxy extends LiveActor {
    private rotateSpeed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, 'MiniRouteGalaxy');

        const miniatureName = infoIter.getValueString('MiniatureName');
        const miniatureType = infoIter.getValueString('StageType');
        const miniatureScale = infoIter.getValueNumber('ScaleMin');
        const miniatureOffset = vec3.fromValues(
            infoIter.getValueNumber('PosOffsetX'),
            infoIter.getValueNumber('PosOffsetY'),
            infoIter.getValueNumber('PosOffsetZ'));

        vec3.add(this.translation, pointInfo.position, miniatureOffset);
        // vec3.set(this.scale, miniatureScale, miniatureScale, miniatureScale);

        this.initModelManagerWithAnm(sceneObjHolder, miniatureName);
        this.initEffectKeeper(sceneObjHolder, null);

        this.rotateSpeed = 0.25 * MathConstants.DEG_TO_RAD;

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        this.startAction(miniatureName);
        emitEffect(sceneObjHolder, this, miniatureName);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(viewerInput);

        const rotateY = getTimeFrames(viewerInput) * this.rotateSpeed;
        mat4.rotateY(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, rotateY);
    }
}

export class MiniRoutePart extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, 'MiniRoutePart');

        const partsTypeName = infoIter.getValueString('PartsTypeName');
        let modelName: string;
        if (partsTypeName === 'WorldWarpPoint')
            modelName = 'MiniWorldWarpPoint';
        else if (partsTypeName === 'EarthenPipe')
            modelName = 'MiniEarthenPipe';
        else if (partsTypeName === 'StarCheckPoint')
            modelName = 'MiniStarCheckPointMark';
        else if (partsTypeName === 'TicoRouteCreator')
            modelName = 'MiniTicoMasterMark';
        else if (partsTypeName === 'StarPieceMine')
            modelName = 'MiniStarPieceMine';
        else
            throw "whoops";

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        vec3.copy(this.translation, pointInfo.position);

        this.tryStartAllAnim('Open');
        if (pointInfo.isPink)
            startBrkIfExist(this.modelInstance, this.arc, 'TicoBuild');
        else
            startBrkIfExist(this.modelInstance, this.arc, 'Normal');

        this.initEffectKeeper(sceneObjHolder, null);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
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
        if (this.effectKeeper !== null)
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

export class EffectObjR100F50SyncClipping extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
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
        bindColorChangeAnimation(this.modelInstance, this.arc, 1, 'Switch');

        emitEffect(sceneObjHolder, this, 'TargetLight');
        emitEffect(sceneObjHolder, this, 'TouchAble');
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
            connectToScene(sceneObjHolder, this, 0x22, 5, DrawBufferType.MAP_OBJ, -1);
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
    // Some people want to disable skyboxes from translating.
    private isSkybox = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneSky(sceneObjHolder, this);

        this.tryStartAllAnim(this.name);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAnim(sceneObjHolder, viewerInput);
        if (this.isSkybox)
            getCamPos(this.translation, viewerInput.camera);
    }
}

const enum AirNrv {
    IN, OUT,
}

export class Air extends LiveActor {
    private distInThresholdSq: number;
    private distOutThresholdSq: number;

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

        this.tryStartAllAnim(getObjectName(infoIter));
        this.initNerve(AirNrv.IN);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        const distanceToPlayer = calcSqDistanceToPlayer(this, viewerInput.camera);

        if (currentNerve === AirNrv.OUT && distanceToPlayer < this.distInThresholdSq) {
            if (this.tryStartAllAnim('Appear'))
                this.modelInstance.animationController.setPhaseToCurrent();
            this.setNerve(AirNrv.IN);
        } else if (currentNerve === AirNrv.IN && distanceToPlayer > this.distOutThresholdSq) {
            if (this.tryStartAllAnim('Disappear'))
                this.modelInstance.animationController.setPhaseToCurrent();
            this.setNerve(AirNrv.OUT);
        }
    }
}

export class PriorDrawAir extends Air {
    // When this actor is drawing, the core drawing routines change slightly -- Air
    // draws in a slightly different spot. We don't implement anything close to core drawing
    // routines yet, so we leave this out for now...
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

export class AstroMapObj extends MapObjActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const initInfo = new MapObjActorInitInfo();
        const objectName = getObjectName(infoIter);
        const domeId = getJMapInfoArg0(infoIter);
        initInfo.setupModelName(AstroMapObj.getModelName(objectName, domeId));
        initInfo.setupConnectToScene();
        initInfo.setupEffect(objectName);
        super(zoneAndLayer, sceneObjHolder, infoIter, initInfo);

        this.tryStartAllAnim('Open');
        this.tryStartAllAnimAndEffect(sceneObjHolder, 'AliveWait');
    }

    private tryStartAllAnimAndEffect(sceneObjHolder: SceneObjHolder, name: string): void {
        this.tryStartAllAnim(name);
        if (this.isObjectName('AstroDomeEntranceKitchen'))
            emitEffect(sceneObjHolder, this, 'KitchenSmoke');
        if (isRegisteredEffect(this, name))
            emitEffect(sceneObjHolder, this, name);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const objectName = getObjectName(infoIter);
        const domeId = getJMapInfoArg0(infoIter);
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
        } else {
            throw "whoops";
        }
    }
}

class ChipBase extends LiveActor {
    private airBubble: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, modelName: string) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.tryStartAllAnim('Wait');

        const isNeedBubble = getJMapInfoArg3(infoIter);
        if (isNeedBubble !== -1) {
            this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble");
            this.airBubble.tryStartAllAnim("Move");
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const isNeedBubble = getJMapInfoArg3(infoIter);
        if (isNeedBubble !== -1)
            sceneObjHolder.modelCache.requestObjectData("AirBubble");
    }
}

export class BlueChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "BlueChip");
    }
}

export class YellowChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "YellowChip");
    }
}

const enum CrystalCageSize { S, M, L }

export class CrystalCage extends LiveActor {
    private size: CrystalCageSize;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, getObjectName(infoIter));

        this.initDefaultPos(sceneObjHolder, infoIter);

        if (this.name === 'CrystalCageS')
            this.size = CrystalCageSize.S;
        else if (this.name === 'CrystalCageM')
            this.size = CrystalCageSize.M;
        else if (this.name === 'CrystalCageL')
            this.size = CrystalCageSize.L;

        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        connectToSceneCrystal(sceneObjHolder, this);

        if (this.size === CrystalCageSize.L)
            this.initEffectKeeper(sceneObjHolder, null);
    }
}
