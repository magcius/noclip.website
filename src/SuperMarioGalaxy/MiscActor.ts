
// Misc actors that aren't big enough to have their own file.

import { LightType } from './DrawBuffer';
import { SceneObjHolder, getObjectName, getDeltaTimeFrames, getTimeFrames, createSceneObj, SceneObj } from './Main';
import { createCsvParser, JMapInfoIter, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoArg7, getJMapInfoBool, getJMapInfoGroupId, getJMapInfoArg4, getJMapInfoArg6 } from './JMapInfo';
import { mat4, vec3 } from 'gl-matrix';
import { MathConstants, computeModelMatrixSRT, clamp, lerp, normToLength, clampRange, isNearZeroVec3, computeModelMatrixR } from '../MathHelpers';
import { colorNewFromRGBA8, Color, colorCopy, colorNewCopy } from '../Color';
import { ColorKind, GXMaterialHelperGfx, MaterialParams, PacketParams, ub_MaterialParams, ub_PacketParams, u_PacketParamsBufferSize, fillPacketParamsData } from '../gx/gx_render';
import { LoopMode } from '../Common/JSYSTEM/J3D/J3DLoader';
import * as Viewer from '../viewer';
import * as RARC from '../j3d/rarc';
import { DrawBufferType, MovementType, CalcAnimType, DrawType, NameObj } from './NameObj';
import { assertExists, leftPad, fallback, nArray, assert } from '../util';
import { Camera } from '../Camera';
import { isGreaterStep, isFirstStep, calcNerveRate, isLessStep, calcNerveValue } from './Spine';
import { LiveActor, makeMtxTRFromActor, LiveActorGroup, ZoneAndLayer, dynamicSpawnZoneAndLayer, MessageType } from './LiveActor';
import { MapPartsRotator, MapPartsRailMover, getMapPartsArgMoveConditionType, MoveConditionType } from './MapParts';
import { isConnectedWithRail } from './RailRider';
import { WorldmapPointInfo } from './LegacyActor';
import { isBckStopped, getBckFrameMax, setLoopMode, initDefaultPos, connectToSceneCollisionMapObjStrongLight, connectToSceneCollisionMapObjWeakLight, connectToSceneCollisionMapObj, connectToSceneEnvironmentStrongLight, connectToSceneEnvironment, connectToSceneMapObjNoCalcAnim, connectToSceneEnemyMovement, connectToSceneNoSilhouettedMapObjStrongLight, connectToSceneMapObj, connectToSceneMapObjStrongLight, connectToSceneNpc, connectToSceneCrystal, connectToSceneSky, connectToSceneIndirectNpc, connectToSceneMapObjMovement, connectToSceneAir, connectToSceneNoSilhouettedMapObj, connectToScenePlanet, connectToScene, connectToSceneItem, connectToSceneItemStrongLight, startBrk, setBrkFrameAndStop, startBtk, startBva, isBtkExist, isBtpExist, startBtp, setBtpFrameAndStop, setBtkFrameAndStop, startBpk, startAction, tryStartAllAnim, startBck, setBckFrameAtRandom, setBckRate, getRandomFloat, getRandomInt, isBckExist, tryStartBck, addHitSensorNpc, sendArbitraryMsg, isExistRail, isBckPlaying, startBckWithInterpole, isBckOneTimeAndStopped, getRailPointPosStart, getRailPointPosEnd, calcDistanceVertical, loadBTIData, isValidDraw, getRailPointNum, moveCoordAndTransToNearestRailPos, getRailTotalLength, isLoopRail, moveCoordToStartPos, setRailCoordSpeed, getRailPos, moveRailRider, getRailDirection, moveCoordAndFollowTrans, calcRailPosAtCoord, isRailGoingToEnd, reverseRailDirection, getRailCoord, moveCoord, moveTransToOtherActorRailPos, setRailCoord, calcRailPointPos } from './ActorUtil';
import { isSensorNpc, HitSensor, isSensorPlayer } from './HitSensor';
import { BTIData } from '../Common/JSYSTEM/JUTTexture';
import { TDDraw } from './DDraw';
import * as GX from '../gx/gx_enum';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { TextureMapping } from '../TextureHolder';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

// Scratchpad
const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();

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

export function emitEffectWithScale(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, scale: number): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = actor.effectKeeper.createEmitter(sceneObjHolder, name);
    vec3.set(scratchVec3, scale, scale, scale);
    emitter!.setGlobalScale(scratchVec3);
}

export function setEffectColor(actor: LiveActor, name: string, prmColor: Color, envColor: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = assertExists(actor.effectKeeper.getEmitter(name));
    emitter.setGlobalPrmColor(prmColor, -1);
    emitter.setGlobalEnvColor(envColor, -1);
}

export function setEffectEnvColor(actor: LiveActor, name: string, color: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = assertExists(actor.effectKeeper.getEmitter(name));
    emitter.setGlobalEnvColor(color, -1);
}

export function deleteEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.deleteEmitter(sceneObjHolder, name);
}

export function forceDeleteEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.forceDeleteEmitter(sceneObjHolder, name);
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

export function isHiddenModel(actor: LiveActor): boolean {
    return !actor.visibleModel;
}

export function calcMtxAxis(axisX: vec3 | null, axisY: vec3 | null, axisZ: vec3 | null, m: mat4): void {
    if (axisX !== null)
        vec3.set(axisX, m[0], m[1], m[2]);
    if (axisY !== null)
        vec3.set(axisY, m[4], m[5], m[6]);
    if (axisZ !== null)
        vec3.set(axisZ, m[8], m[9], m[10]);
}

export function calcActorAxis(axisX: vec3 | null, axisY: vec3 | null, axisZ: vec3 | null, actor: LiveActor): void {
    const m = scratchMatrix;
    makeMtxTRFromActor(m, actor);
    calcMtxAxis(axisX, axisY, axisZ, m);
}

export function calcUpVec(v: vec3, actor: LiveActor): void {
    const m = assertExists(actor.getBaseMtx());
    vec3.set(v, m[4], m[5], m[6]);
}

export function calcMtxFromGravityAndZAxis(dst: mat4, actor: LiveActor, gravityVec: vec3, front: vec3): void {
    vec3.negate(scratchVec3b, gravityVec);
    makeMtxUpFrontPos(dst, scratchVec3b, front, actor.translation);
}

export function getCamPos(v: vec3, camera: Camera): void {
    const m = camera.worldMatrix;
    vec3.set(v, m[12], m[13], m[14]);
}

export function getCamYdir(v: vec3, camera: Camera): void {
    camera.getWorldUp(v);
}

export function getCamZdir(v: vec3, camera: Camera): void {
    camera.getWorldForward(v);
    // SMG uses different Z conventions than noclip.
    v[2] *= -1;
}

export function calcDistToCamera(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.distance(actor.translation, scratch);
}

export function calcSqDistanceToPlayer(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.squaredDistance(actor.translation, scratch);
}

export function calcDistanceToPlayer(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    return calcDistToCamera(actor, camera, scratch);
}

export function getJointNum(actor: LiveActor): number {
    return actor.modelInstance!.shapeInstanceState.jointToParentMatrixArray.length;
}

export function getJointMtx(actor: LiveActor, i: number): mat4 {
    return actor.modelInstance!.shapeInstanceState.jointToParentMatrixArray[i];
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

export function vecKillElement(dst: vec3, a: vec3, b: vec3): number {
    const m = vec3.dot(a, b);
    dst[0] = a[0] - b[0]*m;
    dst[1] = a[1] - b[1]*m;
    dst[2] = a[2] - b[2]*m;
    return m;
}

function getEaseInValue(v0: number, v1: number, v2: number, v3: number): number {
    const t = Math.cos((v0 / v3) * Math.PI * 0.5);
    return lerp(v1, v2, 1 - t);
}

function getEaseOutValue(v0: number, v1: number, v2: number, v3: number): number {
    const t = Math.cos((v0 / v3) * Math.PI * 0.5);
    return lerp(v1, v2, t);
}

function getRandomVector(dst: vec3, range: number): void {
    vec3.set(dst, getRandomFloat(-range, range), getRandomFloat(-range, range), getRandomFloat(-range, range));
}

function rotateVecDegree(dst: vec3, upVec: vec3, degrees: number, m: mat4 = scratchMatrix): void {
    const theta = degrees * MathConstants.DEG_TO_RAD;
    mat4.fromRotation(m, theta, upVec);
    vec3.transformMat4(dst, dst, m);
}

function setMtxAxisXYZ(dst: mat4, x: vec3, y: vec3, z: vec3): void {
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

function setTrans(dst: mat4, pos: vec3): void {
    dst[12] = pos[0];
    dst[13] = pos[1];
    dst[14] = pos[2];
    dst[15] = 1.0;
}

function makeMtxFrontUpPos(dst: mat4, front: vec3, up: vec3, pos: vec3): void {
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

function makeMtxUpFrontPos(dst: mat4, up: vec3, front: vec3, pos: vec3): void {
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

export function isEqualStageName(sceneObjHolder: SceneObjHolder, stageName: string): boolean {
    return sceneObjHolder.scenarioData.getMasterZoneFilename() === stageName;
}

function isHalfProbability(): boolean {
    return Math.random() >= 0.5;
}

function mod(a: number, b: number): number {
    return (a + b) % b;
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
    tryStartAllAnim(model, subModelObjName);
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

class MapObjActorInitInfo {
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
    public initNerve: number | null = null;

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

    public setupNerve(nerve: number): void {
        this.initNerve = nerve;
    }
}

class MapObjActor<TNerve extends number = number> extends LiveActor<TNerve> {
    private bloomModel: ModelObj | null = null;
    private objName: string;
    protected rotator: MapPartsRotator | null = null;
    protected railMover: MapPartsRailMover | null = null;

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
        const connectedWithRail = isConnectedWithRail(infoIter);
        if (connectedWithRail)
            this.initRailRider(sceneObjHolder, infoIter);
        if (connectedWithRail && initInfo.railMover)
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
        if (initInfo.rotator)
            this.rotator = new MapPartsRotator(sceneObjHolder, this, infoIter);

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
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomObjName)) {
            this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, this.name, bloomObjName, this.modelInstance!.modelMatrix);
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

    public startMapPartsFunctions(): void {
        if (this.rotator !== null)
            this.rotator.start();
        if (this.railMover !== null)
            this.railMover.start();
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.rotator !== null)
            this.rotator.movement(sceneObjHolder, viewerInput);
        if (this.railMover !== null)
            this.railMover.movement(sceneObjHolder, viewerInput);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
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

            m[12] = this.translation[0];
            m[13] = this.translation[1];
            m[14] = this.translation[2];
        } else {
            super.calcAndSetBaseMtx(viewerInput);
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

export class ModelObj extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private transformMatrix: mat4 | null, drawBufferType: DrawBufferType, movementType: MovementType, calcAnimType: CalcAnimType) {
        super(zoneAndLayer, sceneObjHolder, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (this.transformMatrix !== null)
            mat4.getTranslation(this.translation, this.transformMatrix);
        if (movementType < -1)
            movementType = 0x08;
        if (calcAnimType < -1)
            calcAnimType = 0x23;
        if (drawBufferType < -1)
            drawBufferType = DrawBufferType.NO_SHADOWED_MAP_OBJ;
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.transformMatrix !== null) {
            mat4.getTranslation(this.translation, this.transformMatrix);
            mat4.copy(this.modelInstance!.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(viewerInput);
        }
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
            this.startMapPartsFunctions();
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

    public receiveMessage(msgType: MessageType, thisSensor: HitSensor | null, otherSensor: HitSensor | null): boolean {
        if (msgType === MessageType.MapPartsRailMover_Vanish && this.getCurrentNerve() === RailMoveObjNrv.Move) {
            this.makeActorDead();
            return true;
        }

        return super.receiveMessage(msgType, thisSensor, otherSensor);
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

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === RailMoveObjNrv.Move) {
            if (isFirstStep(this))
                this.startMapPartsFunctions();

            const isWorking = this.railMover!.isWorking();
            if (!this.isWorking && isWorking)
                this.startMoveInner();

            this.isWorking = this.isWorking;
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

class NPCActorItem {
    public goods0: string = "";
    public goods1: string = "";
    public goodsJoint0: string = "";
    public goodsJoint1: string = "";
}

export class NPCDirector {
    private scratchNPCActorItem = new NPCActorItem();

    constructor(private npcDataArc: RARC.RARC) {
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

export class PlanetMap extends LiveActor {
    private bloomModel: ModelObj | null = null;
    private waterModel: PartsModel | null = null;
    private indirectModel: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModel(sceneObjHolder, this.name, infoIter);
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        tryStartAllAnim(this, this.name);
        this.tryStartMyEffect(sceneObjHolder);
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
            this.bloomModel = createModelObjBloomModel(this.zoneAndLayer, sceneObjHolder, this.name, bloomModelName, this.getBaseMtx()!);
            vec3.copy(this.bloomModel.scale, this.scale);
        }
    }

    private tryStartMyEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.effectKeeper === null)
            return;

        // In SMG1, this appears to just start the object name as the emitter.
        emitEffect(sceneObjHolder, this, this.name);

        // In SMG2, this hasn't been confirmed in source, but it seems to try to start numbered emitters.
        for (let i = 0; i < this.effectKeeper.multiEmitters.length; i++)
            emitEffect(sceneObjHolder, this, `${this.name}${leftPad(''+i, 2, '0')}`);
    }
}

export class RailPlanetMap extends PlanetMap {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
    }
}

class NPCActor<TNerve extends number = number> extends LiveActor<TNerve> {
    public goods0: PartsModel | null = null;
    public goods1: PartsModel | null = null;

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
    
    public makeActorDead(): void {
        super.makeActorDead();
        if (this.goods0 !== null)
            this.goods0.makeActorDead();
        if (this.goods1 !== null)
            this.goods1.makeActorDead();
    }

    public makeActorAppeared(): void {
        super.makeActorAppeared();
        if (this.goods0 !== null)
            this.goods0.makeActorAppeared();
        if (this.goods1 !== null)
            this.goods1.makeActorAppeared();
    }
}

class FixedPosition {
    public transformMatrix = mat4.create();
    private localTrans = vec3.create();

    constructor(private baseMtx: mat4, localTrans: vec3 | null = null) {
        if (localTrans !== null)
            this.setLocalTrans(localTrans);
    }

    public setLocalTrans(localTrans: vec3): void {
        vec3.copy(this.localTrans, localTrans);
    }

    public calc(): void {
        mat4.copy(this.transformMatrix, this.baseMtx);
        mat4.translate(this.transformMatrix, this.transformMatrix, this.localTrans);
    }
}

class PartsModel extends LiveActor {
    public fixedPosition: FixedPosition | null = null;
    public transformMatrix: mat4 | null = null;

    constructor(sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private parentActor: LiveActor, drawBufferType: DrawBufferType, transformMatrix: mat4 | null = null) {
        super(parentActor.zoneAndLayer, sceneObjHolder, objName);
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

        this.transformMatrix = transformMatrix;

        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public initFixedPositionRelative(localTrans: vec3 | null): void {
        this.fixedPosition = new FixedPosition(this.parentActor.modelInstance!.modelMatrix, localTrans);
        this.transformMatrix = this.fixedPosition.transformMatrix;
    }

    public initFixedPositionJoint(jointName: string, localTrans: vec3 | null): void {
        this.fixedPosition = new FixedPosition(this.parentActor.getJointMtx(jointName)!, localTrans);
        this.transformMatrix = this.fixedPosition.transformMatrix;
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAnim(sceneObjHolder, viewerInput);

        if (this.fixedPosition !== null)
            this.fixedPosition.calc();
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.transformMatrix !== null) {
            this.translation[0] = this.transformMatrix[12];
            this.translation[1] = this.transformMatrix[13];
            this.translation[2] = this.transformMatrix[14];
            mat4.copy(this.modelInstance!.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(viewerInput);
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

const starPieceColorTable = [
    colorNewFromRGBA8(0x7F7F00FF),
    colorNewFromRGBA8(0x800099FF),
    colorNewFromRGBA8(0xE7A000FF),
    colorNewFromRGBA8(0x46A108FF),
    colorNewFromRGBA8(0x375AA0FF),
    colorNewFromRGBA8(0xBE330BFF),
    colorNewFromRGBA8(0x808080FF),
];

function checkPass(old: number, new_: number, thresh: number): boolean {
    return old < thresh && new_ >= thresh;
}

export class StarPiece extends LiveActor {
    private effectCounter: number = 0;
    private effectPrmColor: Color;
    private effectEnvColor: Color;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, 'StarPiece');

        let starPieceColorIndex: number = -1;

        if (infoIter !== null) {
            initDefaultPos(sceneObjHolder, this, infoIter);
            starPieceColorIndex = fallback(getJMapInfoArg3(infoIter), -1);
        }

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        if (starPieceColorIndex < 0 || starPieceColorIndex > 5)
            starPieceColorIndex = getRandomInt(1, 7);

        const color = starPieceColorTable[starPieceColorIndex];
        this.effectPrmColor = colorNewCopy(color);
        this.effectPrmColor.r = clamp(this.effectPrmColor.r + 0xFF/0xFF, 0.0, 1.0);
        this.effectPrmColor.g = clamp(this.effectPrmColor.g + 0xFF/0xFF, 0.0, 1.0);
        this.effectPrmColor.b = clamp(this.effectPrmColor.b + 0xFF/0xFF, 0.0, 1.0);

        this.effectEnvColor = colorNewCopy(color);
        this.effectEnvColor.r = clamp(this.effectEnvColor.r + 0x20/0xFF, 0.0, 1.0);
        this.effectEnvColor.g = clamp(this.effectEnvColor.g + 0x20/0xFF, 0.0, 1.0);
        this.effectEnvColor.b = clamp(this.effectEnvColor.b + 0x20/0xFF, 0.0, 1.0);

        this.modelInstance!.setColorOverride(ColorKind.MAT0, color);
        this.initEffectKeeper(sceneObjHolder, 'StarPiece');

        startBtk(this, 'Gift');
        setBtkFrameAndStop(this, 5);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const newCounter = this.effectCounter + getDeltaTimeFrames(viewerInput);
        if (checkPass(this.effectCounter, newCounter, 20))
            this.emitGettableEffect(sceneObjHolder, viewerInput, 4.0);
        this.effectCounter = newCounter % 90;
    }

    private emitGettableEffect(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput, scale: number): void {
        // Due to a bug in the original game, effectScale effectively does nothing, so it doesn't
        // really make sense to calculate it.
        // const effectScale = this.calcEffectScale(viewerInput, scale, 0.8, true);
        const effectScale = 1.0;

        if (calcDistToCamera(this, viewerInput.camera) > 200)
            emitEffectWithScale(sceneObjHolder, this, 'GetAble', effectScale);

        setEffectColor(this, 'GetAble', this.effectPrmColor, this.effectEnvColor);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        // The star piece rotates around the Y axis at 15 degrees every frame.
        const SPEED = MathConstants.DEG_TO_RAD * 15;
        this.rotation[1] += getDeltaTimeFrames(viewerInput) * SPEED;
        super.calcAndSetBaseMtx(viewerInput);
    }
}

export class EarthenPipe extends LiveActor {
    private pipeStream: PartsModel | null = null;
    private scaleY: number;
    private axisY = vec3.create();
    private origTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "EarthenPipe");

        const colorFrame = fallback(getJMapInfoArg7(infoIter), 0);
        startBrk(this, 'EarthenPipe');
        setBrkFrameAndStop(this, colorFrame);

        connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        const hiddenFlag = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        if (hiddenFlag)
            hideModel(this);

        vec3.copy(this.origTranslation, this.translation);

        const obeyLocalGravity = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
        if (false && obeyLocalGravity) {
            // TODO(jstpierre): Compute gravity vectors
        } else {
            calcUpVec(this.axisY, this);
        }

        this.scaleY = 100 * this.scale[1];
        this.scale[1] = 1.0;
        this.calcTrans();

        if (this.name === "EarthenPipeInWater") {
            this.pipeStream = createPartsModelMapObj(sceneObjHolder, this, "EarthenPipeStream");
            tryStartAllAnim(this.pipeStream, "EarthenPipeStream");
        }
    }

    private calcTrans(): void {
        vec3.copy(this.translation, this.axisY);
        vec3.scale(this.translation, this.translation, this.scaleY);
        vec3.add(this.translation, this.translation, this.origTranslation);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("EarthenPipe");

        if (getObjectName(infoIter) === "EarthenPipeInWater")
            sceneObjHolder.modelCache.requestObjectData("EarthenPipeStream");
    }
}

function setEffectHostMtx(actor: LiveActor, effectName: string, hostMtx: mat4): void {
    const emitter = assertExists(actor.effectKeeper!.getEmitter(effectName));
    emitter.setHostMtx(hostMtx);
}

function setEffectHostSRT(actor: LiveActor, effectName: string, translation: vec3 | null, rotation: vec3 | null, scale: vec3 | null): void {
    const emitter = assertExists(actor.effectKeeper!.getEmitter(effectName));
    emitter.setHostSRT(translation, rotation, scale);
}

export class BlackHole extends LiveActor {
    private blackHoleModel: ModelObj;
    private effectHostMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'BlackHoleRange');
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.blackHoleModel = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'BlackHole', 'BlackHole', this.modelInstance!.modelMatrix);
        this.initEffectKeeper(sceneObjHolder, 'BlackHoleRange');
        setEffectHostMtx(this, 'BlackHoleSuction', this.effectHostMtx);

        startBck(this, `BlackHoleRange`);
        startBtk(this, `BlackHoleRange`);
        startBtk(this.blackHoleModel, `BlackHole`);

        let rangeScale: number;
        const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
        if (arg0 < 0) {
            // If this is a cube, we behave slightly differently wrt. scaling.
            if (this.name !== 'BlackHoleCube')
                rangeScale = this.scale[0];
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
            makeMtxFrontUpPos(this.effectHostMtx, front, up, this.translation);
            scaleMatrixScalar(this.effectHostMtx, this.scale[0]);
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
        tryStartAllAnim(this, 'Before');
        tryStartAllAnim(this, 'PeachCastleGardenPlanet');
    }

    protected connectToScene(sceneObjHolder: SceneObjHolder): void {
        connectToScenePlanet(sceneObjHolder, this);
    }
}

export class HatchWaterPlanet extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'HatchWaterPlanet');
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        tryStartAllAnim(this, 'HatchWaterPlanet');
        setLoopMode(this, LoopMode.ONCE);
    }
}

export class Kinopio extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.set(this.scale, 1.2, 1.2, 1.2);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kinopio');
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('Kinopio', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        const arg2 = fallback(getJMapInfoArg2(infoIter), -1);
        if (arg2 === 0) {
            startAction(this, `SpinWait1`);
        } else if (arg2 === 1) {
            startAction(this, `SpinWait2`);
        } else if (arg2 === 2) {
            startAction(this, `SpinWait3`);
        } else if (arg2 === 3) {
            startAction(this, `Wait`);
        } else if (arg2 === 4) {
            startAction(this, `Wait`);
        } else if (arg2 === 5) {
            startAction(this, `SwimWait`);
        } else if (arg2 === 6) {
            startAction(this, `Pickel`);
        } else if (arg2 === 7) {
            startAction(this, `Sleep`);
        } else if (arg2 === 8) {
            startAction(this, `Wait`);
        } else if (arg2 === 9) {
            startAction(this, `KinopioGoodsWeapon`);
        } else if (arg2 === 10) {
            startAction(this, `Joy`);
        } else if (arg2 === 11) {
            startAction(this, `Rightened`);
        } else if (arg2 === 12) {
            startAction(this, `StarPieceWait`);
        } else if (arg2 === 13) {
            startAction(this, `Getaway`);
        } else if (arg2 === -1) {
            if (itemGoodsIdx === 2) {
                startAction(this, `WaitPickel`);
            } else {
                startAction(this, `Wait`);
            }
        }

        setBckFrameAtRandom(this);

        // Bind the color change animation.
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg1(infoIter), 0));

        // If we have an SW_APPEAR, then hide us until that switch triggers...
        if (fallback(infoIter.getValueNumber('SW_APPEAR'), -1) !== -1)
            this.makeActorDead();
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

const enum PenguinNrv { Wait, Dive }

export class Penguin extends NPCActor<PenguinNrv> {
    private arg0: number;
    private diveCounter: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve

        this.boundingSphereRadius = 100;

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordAndTransToNearestRailPos(this);
        }

        this.arg0 = fallback(getJMapInfoArg0(infoIter), -1);
        if (this.arg0 === 0) {
            startAction(this, `SitDown`);
        } else if (this.arg0 === 1) {
            startAction(this, `SwimWait`);
        } else if (this.arg0 === 2) {
            startAction(this, `SwimWaitSurface`);
        } else if (this.arg0 === 3) {
            startAction(this, `SwimWaitSurface`);
        } else if (this.arg0 === 4) {
            startAction(this, `SwimTurtleTalk`);
        } else if (this.arg0 === 6) {
            startAction(this, `Wait`);
        } else {
            startAction(this, `Wait`);
        }

        setBckFrameAtRandom(this);

        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg7(infoIter), 0));

        this.initNerve(PenguinNrv.Wait);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();

        if (currentNerve === PenguinNrv.Wait) {
            if (isFirstStep(this))
                this.diveCounter = getRandomInt(120, 300);

            if (this.arg0 === 3 && isGreaterStep(this, this.diveCounter))
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

class Coin extends LiveActor {
    private airBubble: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, protected isPurpleCoin: boolean) {
        super(zoneAndLayer, sceneObjHolder, isPurpleCoin ? 'PurpleCoin' : 'Coin');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.isPurpleCoin ? 'PurpleCoin' : 'Coin');
        connectToSceneItemStrongLight(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);

        if (infoIter !== null) {
            const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
            if (isNeedBubble) {
                this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble", vec3.fromValues(0, 70, 0));
                tryStartAllAnim(this, "Move");
            }
        }

        tryStartAllAnim(this, 'Move');
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        // TODO(jstpierre): CoinRotater has three separate matrices:
        //   - getCoinRotateYMatrix()
        //   - getCoinInWaterRotateYMatrix()
        //   - getCoinHiSpeedRotateYMatrix()
        // for now we just spin at 4 degrees per frame lol
        const SPEED = MathConstants.DEG_TO_RAD * 4;
        const rotationY = getTimeFrames(viewerInput) * SPEED;
        computeModelMatrixSRT(scratchMatrix, 1, 1, 1, 0, rotationY, 0, 0, 0, 0);
        super.calcAndSetBaseMtx(viewerInput);
        mat4.mul(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, scratchMatrix);
    }
}

export function createCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): Coin {
    return new Coin(zoneAndLayer, sceneObjHolder, infoIter, false);
}

export function createPurpleCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): Coin {
    return new Coin(zoneAndLayer, sceneObjHolder, infoIter, true);
}

export function requestArchivesCoin(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    sceneObjHolder.modelCache.requestObjectData('Coin');
    const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
    if (isNeedBubble)
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
}

export function requestArchivesPurpleCoin(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    sceneObjHolder.modelCache.requestObjectData('PurpleCoin');
    const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
    if (isNeedBubble)
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
}

abstract class CoinGroup extends LiveActor {
    protected coinArray: Coin[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, protected isPurpleCoin: boolean) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const coinCount = fallback(getJMapInfoArg0(infoIter), 0);

        for (let i = 0; i < coinCount; i++) {
            if (this.isPurpleCoin) {
                this.coinArray.push(createPurpleCoin(zoneAndLayer, sceneObjHolder, infoIter));
            } else {
                this.coinArray.push(createCoin(zoneAndLayer, sceneObjHolder, infoIter));
            }

            const coin = this.coinArray[i];
            // Coin has been default init'd at this point. Set some extra properties on it.
            vec3.set(coin.scale, 1, 1, 1);
        }

        this.initCoinArray(sceneObjHolder, infoIter);
        this.placementCoin();

        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.makeActorDead();
    }

    protected abstract initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
    protected abstract placementCoin(): void;

    protected setCoinTrans(i: number, trans: vec3): void {
        vec3.copy(this.coinArray[i].translation, trans);
    }
}

class RailCoin extends CoinGroup {
    protected initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
    }

    protected placementCoin(): void {
        // TODO(jstpierre): MercatorRail
        this.placementNormalRail();
    }

    protected placementNormalRail(): void {
        const coinCount = this.coinArray.length;

        const totalLength = getRailTotalLength(this);

        let speed: number;
        if (coinCount < 2) {
            speed = 0;
        } else {
            if (isLoopRail(this))
                speed = totalLength / coinCount;
            else
                speed = totalLength / (coinCount - 1);
        }

        moveCoordToStartPos(this);
        setRailCoordSpeed(this, speed);

        for (let i = 0; i < coinCount; i++) {
            getRailPos(scratchVec3, this);
            this.setCoinTrans(i, scratchVec3);
            moveRailRider(this);
        }
    }

    // Rail debugging code...
    /*
    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.railRider!.debugDrawRail(viewerInput.camera);
    }
    */
}

export function createRailCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): RailCoin {
    return new RailCoin(zoneAndLayer, sceneObjHolder, infoIter, false);
}

export function createPurpleRailCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): RailCoin {
    return new RailCoin(zoneAndLayer, sceneObjHolder, infoIter, true);
}

class CircleCoinGroup extends CoinGroup {
    private radius: number;

    protected initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.radius = fallback(getJMapInfoArg2(infoIter), 200);
        initDefaultPos(sceneObjHolder, this, infoIter);
    }

    protected placementCoin(): void {
        makeMtxTRFromActor(scratchMatrix, this);
        vec3.set(scratchVec3a, scratchMatrix[0], scratchMatrix[1], scratchMatrix[2]);
        vec3.set(scratchVec3b, scratchMatrix[8], scratchMatrix[9], scratchMatrix[10]);

        const coinCount = this.coinArray.length;
        for (let i = 0; i < coinCount; i++) {
            const theta = (i / coinCount) * MathConstants.TAU;
            vec3.set(scratchVec3, 0, 0, 0);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3a, this.radius * Math.cos(theta));
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3b, this.radius * Math.sin(theta));
            vec3.add(scratchVec3, scratchVec3, this.translation);
            this.setCoinTrans(i, scratchVec3);
        }
    }
}

export function createCircleCoinGroup(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): CircleCoinGroup {
    return new CircleCoinGroup(zoneAndLayer, sceneObjHolder, infoIter, false);
}

export function createPurpleCircleCoinGroup(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): CircleCoinGroup {
    return new CircleCoinGroup(zoneAndLayer, sceneObjHolder, infoIter, true);
}

export class MiniRoutePoint extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRoutePoint');
        this.initModelManagerWithAnm(sceneObjHolder, 'MiniRoutePoint');
        vec3.copy(this.translation, pointInfo.position);

        tryStartAllAnim(this, 'Open');
        if (pointInfo.isPink)
            startBrk(this, 'TicoBuild');
        else
            startBrk(this, 'Normal');

        if (pointInfo.isSmall)
            vec3.set(this.scale, 0.5, 1, 0.5);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }
}

export class MiniRouteGalaxy extends LiveActor {
    private rotateSpeed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRouteGalaxy');

        const miniatureName = assertExists(infoIter.getValueString('MiniatureName'));
        const miniatureType = assertExists(infoIter.getValueString('StageType'));
        const miniatureScale = assertExists(infoIter.getValueNumber('ScaleMin'));
        const miniatureOffset = vec3.fromValues(
            assertExists(infoIter.getValueNumber('PosOffsetX')),
            assertExists(infoIter.getValueNumber('PosOffsetY')),
            assertExists(infoIter.getValueNumber('PosOffsetZ')));

        vec3.add(this.translation, pointInfo.position, miniatureOffset);
        vec3.set(this.scale, miniatureScale, miniatureScale, miniatureScale);

        this.initModelManagerWithAnm(sceneObjHolder, miniatureName);
        this.initEffectKeeper(sceneObjHolder, null);

        if (miniatureType === 'BossGalaxyLv3') {
            this.rotateSpeed = 0;
            this.rotation[1] = -0.25 * Math.PI;
        } else {
            this.rotateSpeed = 0.25 * MathConstants.DEG_TO_RAD;
        }

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        startAction(this, miniatureName);
        emitEffect(sceneObjHolder, this, miniatureName);
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(viewerInput);

        const rotateY = getTimeFrames(viewerInput) * this.rotateSpeed;
        mat4.rotateY(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, rotateY);
    }
}

export class MiniRoutePart extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRoutePart');

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
        if (partsTypeName === 'WorldWarpPoint')
            this.modelInstance!.modelData.shapeData[0].sortKeyBias = 1;
        vec3.copy(this.translation, pointInfo.position);

        tryStartAllAnim(this, 'Open');
        if (pointInfo.isPink)
            startBrk(this, 'TicoBuild');
        else
            startBrk(this, 'Normal');

        this.initEffectKeeper(sceneObjHolder, null);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }
}

export class SimpleEffectObj extends LiveActor {
    private isVisible: boolean = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);

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

export class EffectObjR500F50 extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 500;
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

export class RandomEffectObj extends SimpleEffectObj {
    private counter: number = -1;
    private randBase: number;
    private randRange: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);

        this.randBase = fallback(getJMapInfoArg0(infoIter), 600);
        this.randRange = fallback(getJMapInfoArg1(infoIter), 180);

        this.initNerve(0);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.counter === -1)
            this.counter = this.randBase + (Math.random() * this.randRange * 2 - this.randRange);

        if (this.getNerveStep() >= this.counter) {
            emitEffect(sceneObjHolder, this, this.name);
            this.counter = -1;
            this.spine!.setNerve(0);
        }
    }

    protected getClippingRadius(): number {
        return 400;
    }
}

export class GCaptureTarget extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "GCaptureTarget");
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        startBck(this, 'Wait');
        startBrk(this, 'Switch');
        setBrkFrameAndStop(this, 1);

        emitEffect(sceneObjHolder, this, 'TargetLight');
        emitEffect(sceneObjHolder, this, 'TouchAble');
    }
}

const enum FountainBigNrv { WaitPhase, Wait, Sign, SignStop, Spout, SpoutEnd }

export class FountainBig extends LiveActor<FountainBigNrv> {
    private upVec = vec3.create();
    private randomPhase: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "FountainBig");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        calcUpVec(this.upVec, this);
        vec3.scaleAndAdd(this.upVec, this.translation, this.upVec, 300);

        hideModel(this);
        startBtk(this, "FountainBig");

        // TODO(jstpierre): Figure out what causes this phase for realsies. Might just be culling...
        this.randomPhase = (Math.random() * 300) | 0;

        this.initNerve(FountainBigNrv.WaitPhase);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();

        if (currentNerve === FountainBigNrv.WaitPhase) {
            if (isGreaterStep(this, this.randomPhase)) {
                this.setNerve(FountainBigNrv.Wait);
                return;
            }
        } else if (currentNerve === FountainBigNrv.Wait) {
            if (isGreaterStep(this, 120)) {
                this.setNerve(FountainBigNrv.Sign);
                return;
            }
        } else if (currentNerve === FountainBigNrv.Sign) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'FountainBigSign');

            if (isGreaterStep(this, 80)) {
                this.setNerve(FountainBigNrv.SignStop);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SignStop) {
            if (isFirstStep(this))
                deleteEffect(sceneObjHolder, this, 'FountainBigSign');

            if (isGreaterStep(this, 30)) {
                this.setNerve(FountainBigNrv.Spout);
                return;
            }
        } else if (currentNerve === FountainBigNrv.Spout) {
            if (isFirstStep(this)) {
                showModel(this);
                emitEffect(sceneObjHolder, this, 'FountainBig');
            }

            const t = calcNerveRate(this, 20);
            if (t <= 1) {
                this.scale[1] = clamp(t, 0.01, 1);
            }

            if (isGreaterStep(this, 180)) {
                deleteEffect(sceneObjHolder, this, 'FountainBig');
                this.setNerve(FountainBigNrv.SpoutEnd);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SpoutEnd) {
            const t = 1 - calcNerveRate(this, 10);
            this.scale[1] = clamp(t, 0.01, 1);

            if (isGreaterStep(this, 10)) {
                hideModel(this);
                this.setNerve(FountainBigNrv.Wait);
                return;
            }
        }
    }
}

export class Fountain extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));
        emitEffect(sceneObjHolder, this, getObjectName(infoIter));
    }

    public static requestArchives(): void {
        // Do nothing; no archive for this object.
    }
}

export class PhantomTorch extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));
        emitEffect(sceneObjHolder, this, getObjectName(infoIter));
    }

    public static requestArchives(): void {
        // Do nothing; no archive for this object.
    }
}

export class AstroEffectObj extends SimpleEffectObj {
    // The game will check whether the user has the correct dome enabled,
    // but it is otherwise identical to SimpleEffectObj.
}

export class AstroCountDownPlate extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "AstroCountDownPlate");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        emitEffect(sceneObjHolder, this, "Light");

        startBrk(this, "Green");
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

export class Sky extends LiveActor {
    // Some people want to disable skyboxes from translating.
    private isSkybox = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneSky(sceneObjHolder, this);

        tryStartAllAnim(this, this.name);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox)
            getCamPos(this.translation, viewerInput.camera);
        super.calcAnim(sceneObjHolder, viewerInput);
    }
}

const enum AirNrv { In, Out }

export class Air extends LiveActor<AirNrv> {
    private distInThresholdSq: number;
    private distOutThresholdSq: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneAir(sceneObjHolder, this);

        let thresholdParam = fallback(getJMapInfoArg0(infoIter), -1);
        if (thresholdParam < 0)
            thresholdParam = 70;

        const distInThreshold = 100 * thresholdParam;
        this.distInThresholdSq = distInThreshold*distInThreshold;
        const distOutThreshold = 100 * (20 + thresholdParam);
        this.distOutThresholdSq = distOutThreshold*distOutThreshold;

        tryStartAllAnim(this, getObjectName(infoIter));
        this.initNerve(AirNrv.In);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        const distanceToPlayer = calcSqDistanceToPlayer(this, viewerInput.camera);

        if (currentNerve === AirNrv.Out && distanceToPlayer < this.distInThresholdSq) {
            if (tryStartAllAnim(this, 'Appear'))
            this.setNerve(AirNrv.In);
        } else if (currentNerve === AirNrv.In && distanceToPlayer > this.distOutThresholdSq) {
            if (tryStartAllAnim(this, 'Disappear'))
            this.setNerve(AirNrv.Out);
        }
    }
}

export class PriorDrawAir extends Air {
    // When this actor is drawing, the core drawing routines change slightly -- Air
    // draws in a slightly different spot. We don't implement anything close to core drawing
    // routines yet, so we leave this out for now...
}

const enum ShootingStarNrv { PreShooting, Shooting, WaitForNextShoot }

export class ShootingStar extends LiveActor<ShootingStarNrv> {
    private delay: number;
    private distance: number;
    private axisY = vec3.create();
    private initialTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneMapObj(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.initialTranslation, this.translation);

        const numStarBits = fallback(getJMapInfoArg0(infoIter), 5);
        this.delay = fallback(getJMapInfoArg1(infoIter), 240);
        this.distance = fallback(getJMapInfoArg2(infoIter), 2000);

        this.initNerve(ShootingStarNrv.PreShooting);
        this.initEffectKeeper(sceneObjHolder, 'ShootingStar');

        this.calcAndSetBaseMtxBase();

        calcUpVec(this.axisY, this);

        startBpk(this, 'ShootingStar');
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const SPEED = 10 * MathConstants.DEG_TO_RAD;
        this.rotation[1] = (this.rotation[1] + (SPEED * getDeltaTimeFrames(viewerInput))) % MathConstants.TAU;
        const currentNerve = this.getCurrentNerve();

        if (currentNerve === ShootingStarNrv.PreShooting) {
            if (isFirstStep(this)) {
                vec3.scaleAndAdd(this.translation, this.initialTranslation, this.axisY, this.distance);
                showModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarAppear');
            }

            const scale = calcNerveRate(this, 20);
            vec3.set(this.scale, scale, scale, scale);

            if (isGreaterStep(this, 20)) {
                this.setNerve(ShootingStarNrv.Shooting);
            }
        } else if (currentNerve === ShootingStarNrv.Shooting) {
            if (isFirstStep(this)) {
                vec3.negate(this.velocity, this.axisY);
                vec3.scale(this.velocity, this.velocity, 25);
                emitEffect(sceneObjHolder, this, 'ShootingStarBlur');
            }

            if (isGreaterStep(this, 360)) {
                this.setNerve(ShootingStarNrv.WaitForNextShoot);
                deleteEffect(sceneObjHolder, this, 'ShootingStarBlur');
            }
        } else if (currentNerve === ShootingStarNrv.WaitForNextShoot) {
            if (isFirstStep(this)) {
                hideModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarBreak');
                vec3.set(this.velocity, 0, 0, 0);
            }

            if (isGreaterStep(this, this.delay)) {
                this.setNerve(ShootingStarNrv.PreShooting);
            }
        }
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
            this.startMapPartsFunctions();

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

class ChipBase extends LiveActor {
    private airBubble: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, modelName: string) {
        super(zoneAndLayer, sceneObjHolder, modelName);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        tryStartAllAnim(this, 'Wait');

        if (infoIter !== null) {
            const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
            if (isNeedBubble) {
                this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble");
                tryStartAllAnim(this, "Move");
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
        if (isNeedBubble)
            sceneObjHolder.modelCache.requestObjectData("AirBubble");
    }
}

export class BlueChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "BlueChip");
    }
}

export class YellowChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "YellowChip");
    }
}

const enum CrystalCageSize { S, M, L }

export class CrystalCage extends LiveActor {
    private size: CrystalCageSize;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

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

const enum LavaSteamNrv { Wait, Steam }

export class LavaSteam extends LiveActor<LavaSteamNrv> {
    private effectScale = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'LavaSteam');
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostSRT(this, 'Sign', this.translation, this.rotation, this.effectScale);

        this.initNerve(LavaSteamNrv.Wait);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === LavaSteamNrv.Wait) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Sign');
                vec3.set(this.effectScale, 1, 1, 1);
            }

            if (isGreaterStep(this, 0x52)) {
                const scale = getEaseInValue((0x5a - this.getNerveStep()) * 0.125, 0.001, 1.0, 1.0);
                vec3.set(this.effectScale, scale, scale, scale);
            }

            if (isGreaterStep(this, 0x5a)) {
                forceDeleteEffect(sceneObjHolder, this, 'Sign');
            }

            if (isGreaterStep(this, 0x78)) {
                this.setNerve(LavaSteamNrv.Steam);
            }
        } else if (currentNerve === LavaSteamNrv.Steam) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Steam');
            }

            if (isGreaterStep(this, 0x5a)) {
                deleteEffect(sceneObjHolder, this, 'Steam');
                this.setNerve(LavaSteamNrv.Wait);
            }
        }
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

export class WoodBox extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WoodBox");
        connectToSceneMapObjStrongLight(sceneObjHolder, this);
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);
    }
}

export class SurprisedGalaxy extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "MiniSurprisedGalaxy");
        connectToSceneMapObj(sceneObjHolder, this);
        startAction(this, 'MiniSurprisedGalaxy');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("MiniSurprisedGalaxy");
    }
}

class SuperSpinDriver extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, colorArg: number) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "SuperSpinDriver");
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);

        this.initColor(colorArg);
        startBck(this, 'Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("SuperSpinDriver");
    }

    private initColor(colorArg: number): void {
        startBtp(this, 'SuperSpinDriver');
        setBtpFrameAndStop(this, colorArg);

        if (colorArg === 0) {
            startBrk(this, 'Yellow');
        } else if (colorArg === 1) {
            startBrk(this, 'Green');
        } else {
            startBrk(this, 'Pink');
        }
    }
}

export function requestArchivesSuperSpinDriver(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    SuperSpinDriver.requestArchives(sceneObjHolder, infoIter);
}

export function createSuperSpinDriverYellow(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 0);
}

export function createSuperSpinDriverGreen(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 1);
}

export function createSuperSpinDriverPink(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 2);
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

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        super.calcAndSetBaseMtx(viewerInput);

        vec3.scale(scratchVec3, this.gravityVector, this.waveForce.getCurrentValue());
        mat4.translate(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, scratchVec3);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.waveForce.update(getDeltaTimeFrames(viewerInput));

        // Check for ripple effect.
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

const enum FishNrv { Approach, Wander }

class Fish extends LiveActor<FishNrv> {
    private followPointPos = vec3.create();
    private offset = vec3.create();
    private direction = vec3.create();
    private counter = 0;
    private approachThreshold: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private fishGroup: FishGroup, modelName: string) {
        super(zoneAndLayer, sceneObjHolder, modelName);

        vec3.set(this.offset, getRandomFloat(-150, 150), getRandomFloat(-150, 150), getRandomFloat(-150, 150));
        this.approachThreshold = getRandomFloat(100, 500);

        this.updateFollowPointPos();
        vec3.copy(this.translation, this.followPointPos);
        getRailDirection(this.direction, this.fishGroup);

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        startBck(this, 'Swim');

        this.initNerve(FishNrv.Wander);

        connectToSceneEnvironment(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();

        if (currentNerve === FishNrv.Approach) {
            if (isFirstStep(this))
                this.counter = 0;

            --this.counter;
            if (this.counter < 1) {
                vec3.sub(scratchVec3, this.followPointPos, this.translation);
                vec3.normalize(scratchVec3, scratchVec3);

                if (vec3.dot(scratchVec3, this.direction) <= 0.9) {
                    vec3.lerp(this.direction, this.direction, scratchVec3, 0.8);

                    if (isNearZeroVec3(this.direction, 0.01))
                        vec3.copy(this.direction, scratchVec3);
                    else
                        vec3.normalize(this.direction, this.direction);
                } else {
                    vec3.copy(this.direction, scratchVec3);
                }

                vec3.scaleAndAdd(this.velocity, this.velocity, this.direction, 5);
                this.counter = getRandomInt(5, 30);
            }

            if (vec3.squaredDistance(this.followPointPos, this.translation) < (this.approachThreshold * this.approachThreshold))
                this.setNerve(FishNrv.Wander);
        } else if (currentNerve === FishNrv.Wander) {
            if (isFirstStep(this))
                this.counter = 0;

            --this.counter;
            if (this.counter < 1) {
                vec3.add(this.velocity, this.velocity, this.direction);
                this.counter = getRandomInt(60, 180);
            }

            if (vec3.squaredDistance(this.followPointPos, this.translation) > (this.approachThreshold * this.approachThreshold))
                this.setNerve(FishNrv.Approach);
        }

        vec3.scale(this.velocity, this.velocity, 0.95);

        setBckRate(this, 0.2 * vec3.length(this.velocity));

        if (isNearZeroVec3(this.direction, 0.001)) {
            if (isNearZeroVec3(this.velocity, 0.001)) {
                vec3.set(this.direction, 1, 0, 0);
            } else {
                vec3.copy(this.direction, this.velocity);
            }
        }

        this.updateFollowPointPos();
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        makeMtxFrontUpPos(this.modelInstance!.modelMatrix, this.direction, this.fishGroup.upVec, this.translation);
    }

    private updateFollowPointPos(): void {
        getRailPos(this.followPointPos, this.fishGroup);
        vec3.add(this.followPointPos, this.followPointPos, this.offset);
    }
}

export class FishGroup extends LiveActor {
    private railSpeed: number = 5;
    private fish: Fish[] = [];
    public upVec = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const fishCount = fallback(getJMapInfoArg0(infoIter), 10);

        initDefaultPos(sceneObjHolder, this, infoIter);
        calcActorAxis(null, this.upVec, null, this);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToNearestRailPos(this);

        const modelName = FishGroup.getArchiveName(infoIter);
        for (let i = 0; i < fishCount; i++)
            this.fish.push(new Fish(zoneAndLayer, sceneObjHolder, this, modelName));

        connectToSceneEnemyMovement(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        // Update up vector from gravity vector
        // vec3.negate(this.upVec, this.gravityVector);

        moveCoordAndFollowTrans(this, this.railSpeed * getDeltaTimeFrames(viewerInput));

        // this.railRider!.debugDrawRail(viewerInput.camera, 50);
    }

    private static getArchiveName(infoIter: JMapInfoIter): string {
        const actorName = getObjectName(infoIter);

        if (actorName === 'FishGroupA')
            return 'FishA';
        else if (actorName === 'FishGroupB')
            return 'FishB';
        else if (actorName === 'FishGroupC')
            return 'FishC';
        else if (actorName === 'FishGroupD')
            return 'FishD';
        else if (actorName === 'FishGroupE')
            return 'FishE';
        else if (actorName === 'FishGroupF')
            return 'FishF';

        throw "whoops";
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(FishGroup.getArchiveName(infoIter));
    }
}

const enum SeaGullNrv { HoverFront, HoverLeft, HoverRight }

class SeaGull extends LiveActor<SeaGullNrv> {
    private direction: boolean;
    private updatePosCounter: number;
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private upVec = vec3.create();
    private chasePointIndex: number;
    private bankRotation: number = 0;
    private hoverStep: number = 0;
    private flyUpCounter: number = 0;
    private maintainHeightCounter: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private seaGullGroup: SeaGullGroup, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        calcActorAxis(this.axisX, this.axisY, this.axisZ, this);
        vec3.copy(this.upVec, this.axisY);

        this.initModelManagerWithAnm(sceneObjHolder, 'SeaGull');
        startBck(this, 'Fly');
        connectToSceneEnvironment(sceneObjHolder, this);

        const totalLength = getRailTotalLength(this.seaGullGroup);
        const coord = getRandomFloat(1.0, totalLength - 1.0);
        this.chasePointIndex = (coord / 500.0) | 0;
        calcRailPosAtCoord(this.translation, this.seaGullGroup, coord);

        this.direction = isHalfProbability();
        this.updatePosCounter = getRandomInt(0, 180);

        this.chasePointIndex = this.seaGullGroup.updatePosInfoIndex(this.chasePointIndex, this.direction);

        vec3.scale(scratchVec3a, this.axisX, getRandomFloat(-1.0, 1.0));
        vec3.scale(scratchVec3b, this.axisZ, getRandomFloat(-1.0, 1.0));

        vec3.add(this.axisZ, scratchVec3a, scratchVec3b);
        vec3.normalize(this.axisZ, this.axisZ);

        this.initNerve(SeaGullNrv.HoverFront);
    }

    private updateHover(): void {
        if (Math.abs(this.bankRotation) > 0.01) {
            // vec3.negate(this.upVec, this.gravityVector);

            this.bankRotation = clampRange(this.bankRotation, 30);

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * this.bankRotation, this.axisZ);
            vec3.transformMat4(this.axisY, this.upVec, scratchMatrix);

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * -0.01 * this.bankRotation, this.upVec);
            vec3.transformMat4(this.axisZ, this.axisZ, scratchMatrix);
        }

        vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, 0.05);

        if (this.flyUpCounter < 1) {
            this.velocity[1] -= 0.005;

            const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
            vec3.sub(scratchVec3, chasePoint, this.translation);
            const dist = vec3.dot(scratchVec3, this.upVec);
            if (dist >= 500.0) {
                --this.maintainHeightCounter;
                if (dist > 500.0 || this.maintainHeightCounter < 1)
                    this.flyUpCounter = getRandomInt(30, 180);
            } else {
                this.maintainHeightCounter = 300;
            }
        } else {
            vec3.scaleAndAdd(this.velocity, this.velocity, this.axisY, 0.04);
            --this.flyUpCounter;
            if (this.flyUpCounter < 1)
                this.maintainHeightCounter = getRandomInt(60, 300);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        // nerves
        const currentNerve = this.getCurrentNerve();
        if (currentNerve === SeaGullNrv.HoverFront) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(0, 60);

            this.bankRotation *= 0.995 * getDeltaTimeFrames(viewerInput);
            if (isGreaterStep(this, this.hoverStep)) {
                const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
                vec3.subtract(scratchVec3, chasePoint, this.translation);
                if (vec3.squaredLength(scratchVec3) > 500) {
                    const p = vec3.dot(this.axisX, scratchVec3);
                    if (p <= 0)
                        this.setNerve(SeaGullNrv.HoverRight);
                    else
                        this.setNerve(SeaGullNrv.HoverLeft);
                }
            }
        } else if (currentNerve === SeaGullNrv.HoverLeft) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(60, 120);

            this.bankRotation -= 0.1 * getDeltaTimeFrames(viewerInput);

            if (isGreaterStep(this, this.hoverStep))
                this.setNerve(SeaGullNrv.HoverFront);
        } else if (currentNerve === SeaGullNrv.HoverRight) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(60, 120);

            this.bankRotation += 0.1 * getDeltaTimeFrames(viewerInput);

            if (isGreaterStep(this, this.hoverStep))
                this.setNerve(SeaGullNrv.HoverFront);
        }

        // control
        this.updateHover();

        if (vec3.squaredLength(this.velocity) > 10*10)
            normToLength(this.velocity, 10);

        vec3.cross(this.axisX, this.axisY, this.axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisY, this.axisZ, this.axisX);
        vec3.normalize(this.axisY, this.axisY);

        --this.updatePosCounter;
        if (this.updatePosCounter < 1) {
            this.chasePointIndex = this.seaGullGroup.updatePosInfoIndex(this.chasePointIndex, this.direction);
            this.updatePosCounter = 180;
        }

        // Debugging
        /*
        const ctx = getDebugOverlayCanvas2D();
        const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
        drawWorldSpacePoint(ctx, viewerInput.camera, chasePoint, Magenta, 10);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisX, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera, this.translation, scratchVec3, Red);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisY, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera, this.translation, scratchVec3, Green);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisZ, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera, this.translation, scratchVec3, Blue);
        */
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        setMtxAxisXYZ(this.modelInstance!.modelMatrix, this.axisX, this.axisY, this.axisZ);
        setTrans(this.modelInstance!.modelMatrix, this.translation);
    }
}

export class SeaGullGroup extends LiveActor {
    private seaGulls: SeaGull[] = [];
    public points: vec3[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const seaGullCount = fallback(getJMapInfoArg0(infoIter), 10);

        this.initRailRider(sceneObjHolder, infoIter);
        getRailPos(this.translation, this);
        const railTotalLength = getRailTotalLength(this);
        const pointCount = ((railTotalLength / 500.0) | 0) + 1;
        const pointDist = railTotalLength / pointCount;

        for (let i = 0; i < pointCount; i++) {
            const point = vec3.create();
            calcRailPosAtCoord(point, this, pointDist * i);
            this.points.push(point);
        }

        for (let i = 0; i < seaGullCount; i++)
            this.seaGulls.push(new SeaGull(zoneAndLayer, sceneObjHolder, this, infoIter));
    }

    public updatePosInfoIndex(index: number, direction: boolean): number {
        const step = direction ? -1 : 1;
        return mod(index + step, this.points.length);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('SeaGull');
    }
}

class CoconutTreeLeaf extends LiveActor {
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private upVec = vec3.create();
    private currentPoint = vec3.create();
    private chasePoint = vec3.create();
    private accelCounter = 0;
    private waitCounter = 0;
    private accel = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private leafGroup: CoconutTreeLeafGroup, private jointMtx: mat4, private treeAxisZ: vec3) {
        super(zoneAndLayer, sceneObjHolder, 'CoconutTreeLeaf');

        calcMtxAxis(this.axisX, this.axisY, this.axisZ, this.jointMtx);
        vec3.copy(this.upVec, this.axisY);

        mat4.getTranslation(this.translation, this.jointMtx);

        vec3.scaleAndAdd(this.chasePoint, this.translation, this.axisZ, 100.0);
        vec3.copy(this.currentPoint, this.chasePoint);
    }

    public getBaseMtx(): mat4 {
        return this.jointMtx;
    }

    public update(scaleZ: number, scaleX: number, deltaTimeFrames: number): void {
        const isOnPlayer = false;

        let velUp: number, velDrag: number, velChase: number;
        if (isOnPlayer) {
            velUp = 0.2;
            velDrag = 0.95;
            velChase = 0.01;
        } else {
            velUp = 0.005;
            velDrag = 0.99;
            velChase = 0.001;

            if (this.accelCounter < 1) {
                --this.waitCounter;

                if (this.waitCounter < 1) {
                    vec3.scale(this.accel, this.treeAxisZ, scaleZ);
                    vec3.scaleAndAdd(this.accel, this.accel, this.upVec, scaleX * getRandomFloat(-1.0, 1.0));
                    this.accelCounter = getRandomFloat(10, 30);
                }
            } else {
                vec3.add(this.velocity, this.velocity, this.accel);
                --this.accelCounter;
                if (this.accelCounter < 1)
                    this.waitCounter = getRandomInt(15, 150);
            }
        }

        vec3.scaleAndAdd(this.velocity, this.velocity, this.upVec, -velUp);

        vec3.sub(scratchVec3, this.chasePoint, this.currentPoint);
        const mag = -vec3.dot(this.chasePoint, this.treeAxisZ);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3, velChase);

        vec3.scale(this.velocity, this.velocity, velDrag);
        vec3.scaleAndAdd(this.currentPoint, this.currentPoint, this.velocity, deltaTimeFrames);
        vec3.sub(this.axisZ, this.currentPoint, this.translation);
        vec3.normalize(this.axisZ, this.axisZ);

        vec3.scaleAndAdd(scratchVec3, this.upVec, this.treeAxisZ, 0.01 * mag);
        vec3.cross(this.axisX, scratchVec3, this.axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisY, this.axisZ, this.axisX);
        vec3.normalize(this.axisY, this.axisY);
        setMtxAxisXYZ(this.jointMtx, this.axisX, this.axisY, this.axisZ);
    }
}

export class CoconutTreeLeafGroup extends LiveActor {
    private leaves: CoconutTreeLeaf[] = [];
    private axisZ = vec3.fromValues(0, 0, 1);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'CoconutTreeLeaf');
        connectToSceneMapObjNoCalcAnim(sceneObjHolder, this);

        const leafCount = getJointNum(this) - 1;
        for (let i = 0; i < leafCount; i++) {
            const jointMtx = getJointMtx(this, i);
            this.leaves.push(new CoconutTreeLeaf(zoneAndLayer, sceneObjHolder, this, jointMtx, this.axisZ));
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const dist = calcDistanceToPlayer(this, viewerInput.camera);
        let a = 0, b = 0;

        if (dist > 5000.0) {
            a = 0.05;
            b = 0.03;
        } else if (dist > 3000.0) {
            a = 0.03;
            b = 0.01;
        } else {
            a = 0.02;
            b = 0.005;
        }

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        for (let i = 0; i < this.leaves.length; i++)
            this.leaves[i].update(a, b, deltaTimeFrames);
    }
}

const enum AirBubbleNrv { Wait, Move, KillWait }

export class AirBubble extends LiveActor<AirBubbleNrv> {
    private lifetime: number = 180;
    private spawnLocation = vec3.create();
    private accel = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, `AirBubble`);

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.spawnLocation, this.translation);
        this.initModelManagerWithAnm(sceneObjHolder, 'AirBubble');
        connectToSceneItem(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(AirBubbleNrv.Wait);

        startBck(this, 'Move');
    }

    public appearMove(pos: vec3, lifetime: number): void {
        vec3.copy(this.translation, pos);
        this.makeActorAppeared();
        showModel(this);
        this.setNerve(AirBubbleNrv.Move);

        if (lifetime <= 0)
            lifetime = 180;

        this.lifetime = lifetime;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === AirBubbleNrv.Wait) {
        } else if (currentNerve === AirBubbleNrv.Move) {
            if (isFirstStep(this)) {
                // Calc gravity.
                vec3.set(this.gravityVector, 0, -1, 0);

                vec3.negate(scratchVec3, this.gravityVector);
                vec3.scale(this.velocity, scratchVec3, 7.0);
            }

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * 1.5, this.gravityVector);
            vec3.transformMat4(this.accel, this.accel, scratchMatrix);
            vec3.scaleAndAdd(this.accel, this.accel, this.gravityVector, -vec3.dot(this.gravityVector, this.accel));
            if (isNearZeroVec3(this.accel, 0.001))
                getRandomVector(this.accel, 1.0);
            vec3.normalize(this.accel, this.accel);

            vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, 0.1);
            vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -0.3);

            vec3.scale(this.velocity, this.velocity, 0.85);
            if (isGreaterStep(this, this.lifetime)) {
                hideModel(this);
                emitEffect(sceneObjHolder, this, 'RecoveryBubbleBreak');
                this.setNerve(AirBubbleNrv.KillWait);
            }
        } else if (currentNerve === AirBubbleNrv.KillWait) {
            if (isGreaterStep(this, 90))
                this.makeActorDead();
        }
    }
}

export class AirBubbleHolder extends LiveActorGroup<AirBubble> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'AirBubbleHolder', 0x40);

        for (let i = 0; i < 0x20; i++) {
            const bubble = new AirBubble(dynamicSpawnZoneAndLayer, sceneObjHolder, null);
            bubble.makeActorDead();
            this.registerActor(bubble);
        }
    }

    public appearAirBubble(pos: vec3, lifetime: number): void {
        const bubble = this.getDeadActor();
        if (bubble !== null)
            bubble.appearMove(pos, lifetime);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
    }
}

const enum AirBubbleGeneratorNrv { Wait, Generate }

export class AirBubbleGenerator extends LiveActor<AirBubbleGeneratorNrv> {
    private delay: number;
    private lifetime: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        createSceneObj(sceneObjHolder, SceneObj.AIR_BUBBLE_HOLDER);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'AirBubbleGenerator');
        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(AirBubbleGeneratorNrv.Wait);

        this.delay = fallback(getJMapInfoArg0(infoIter), 180);
        this.lifetime = fallback(getJMapInfoArg1(infoIter), -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === AirBubbleGeneratorNrv.Wait) {
            if (isGreaterStep(this, this.delay))
                this.setNerve(AirBubbleGeneratorNrv.Generate);
        } else if (currentNerve === AirBubbleGeneratorNrv.Generate) {
            if (isFirstStep(this)) {
                startBck(this, 'Generate');
            }

            if (isGreaterStep(this, 6)) {
                calcActorAxis(null, scratchVec3, null, this);
                vec3.scaleAndAdd(scratchVec3, this.translation, scratchVec3, 120);
                sceneObjHolder.airBubbleHolder!.appearAirBubble(scratchVec3, this.lifetime);
                this.setNerve(AirBubbleGeneratorNrv.Wait);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        AirBubbleHolder.requestArchives(sceneObjHolder, infoIter);
    }
}

const enum TreasureBoxType {
    Normal, Cracked, Gold,
}

const enum TreasureBoxNrv { Wait, AlwaysOpen }

export class TreasureBoxCracked extends LiveActor<TreasureBoxNrv> {
    private type: TreasureBoxType;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        this.type = TreasureBoxCracked.getBoxType(infoIter);

        if (this.type === TreasureBoxType.Cracked)
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBoxCracked');
        else if (this.type === TreasureBoxType.Gold)
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBoxGold');
        else
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBox');

        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        const arg2 = fallback(getJMapInfoArg2(infoIter), 0);
        if (arg2 === 2) {
            this.initNerve(TreasureBoxNrv.AlwaysOpen);
        } else {
            this.initNerve(TreasureBoxNrv.Wait);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === TreasureBoxNrv.Wait) {
            if (this.type === TreasureBoxType.Cracked) {
                startBrk(this, `Wait`);
                emitEffect(sceneObjHolder, this, `Light`);
            } else if (this.type === TreasureBoxType.Gold) {
                emitEffect(sceneObjHolder, this, `Gold`);
            }
        } else if (currentNerve === TreasureBoxNrv.AlwaysOpen) {
            // TODO(jstpierre): Go to end of Bck animation.
        }
    }

    public static getBoxType(infoIter: JMapInfoIter): TreasureBoxType {
        const objectName = getObjectName(infoIter);

        if (objectName.includes('TreasureBoxCracked'))
            return TreasureBoxType.Cracked;
        else if (objectName.includes('TreasureBoxGold'))
            return TreasureBoxType.Gold;
        else
            return TreasureBoxType.Normal;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const objectName = getObjectName(infoIter);

        if (objectName.includes('TreasureBoxCracked'))
            sceneObjHolder.modelCache.requestObjectData('TreasureBoxCracked');
        else if (objectName.includes('TreasureBoxGold'))
            sceneObjHolder.modelCache.requestObjectData('TreasureBoxGold');
        else
            sceneObjHolder.modelCache.requestObjectData('TreasureBox');
    }
}

const enum TicoRailNrv { Wait, LookAround, MoveSignAndTurn, MoveSign, Move, Stop, TalkStart, Talk, TalkCancel, GoodBye }

export class TicoRail extends LiveActor<TicoRailNrv> {
    public direction = vec3.create();
    private talkingActor: LiveActor | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, `Tico`);
        connectToSceneNpc(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorNpc(sceneObjHolder, this, 'body', 8, 50.0, vec3.fromValues(0, 50.0, 0));
        this.hitSensorKeeper!.validateBySystem();
        this.initLightCtrl(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToNearestRailPos(this);
        getRailDirection(this.direction, this);
        const colorChangeFrame = fallback(getJMapInfoArg0(infoIter), 0);
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, colorChangeFrame);

        const rnd = getRandomInt(0, 2);
        if (rnd === 0)
            this.initNerve(TicoRailNrv.Wait);
        else
            this.initNerve(TicoRailNrv.Move);
    }

    public attackSensor(thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (isSensorPlayer(otherSensor)) {
            // sendMsgPush
        } else if (isSensorNpc(otherSensor)) {
            const currentNerve = this.getCurrentNerve();
            if (currentNerve !== TicoRailNrv.TalkStart && currentNerve !== TicoRailNrv.Talk && currentNerve !== TicoRailNrv.TalkCancel && currentNerve !== TicoRailNrv.GoodBye) {
                if (sendArbitraryMsg(MessageType.TicoRail_StartTalk, otherSensor, thisSensor)) {
                    this.talkingActor = otherSensor.actor;
                    this.setNerve(TicoRailNrv.TalkStart);
                } else {
                    // If we're going in the same direction, no need to do anything.
                    if (isExistRail(otherSensor.actor) && isRailGoingToEnd(this) === isRailGoingToEnd(otherSensor.actor))
                        return;

                    this.setNerve(TicoRailNrv.TalkCancel);
                }
            }
        }
    }

    private isSameRailActor(other: LiveActor): boolean {
        if (!isExistRail(other))
            return false;

        return vec3.equals(getRailPointPosStart(this), getRailPointPosStart(other)) && vec3.equals(getRailPointPosEnd(this), getRailPointPosEnd(other));
    }

    public receiveMessage(messageType: MessageType, thisSensor: HitSensor | null, otherSensor: HitSensor | null): boolean {
        if (messageType === MessageType.TicoRail_StartTalk) {
            const currentNerve = this.getCurrentNerve();

            if (currentNerve !== TicoRailNrv.TalkStart && currentNerve !== TicoRailNrv.Talk && currentNerve !== TicoRailNrv.TalkCancel && currentNerve !== TicoRailNrv.GoodBye) {
                if (this.isSameRailActor(otherSensor!.actor)) {
                    const rnd = getRandomInt(0, 2);
                    if (rnd !== 0) {
                        const dist = calcDistanceVertical(this, otherSensor!.actor.translation);
                        if (dist <= 30) {
                            this.talkingActor = otherSensor!.actor;
                            this.setNerve(TicoRailNrv.TalkStart);
                            return true;
                        }
                    }
                }
            }

            return false;
        } else {
            return super.receiveMessage(messageType, thisSensor, otherSensor);
        }
    }

    public calcAndSetBaseMtx(viewerInput: Viewer.ViewerRenderInput): void {
        // Gravity vector
        vec3.set(this.gravityVector, 0, -1, 0);
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.direction);
    }

    private isGreaterEqualStepAndRandom(v: number): boolean {
        if (isGreaterStep(this, v + 300))
            return true;

        if (isGreaterStep(this, v)) {
            if (getRandomInt(0, 300) === 0)
                return true;
        }

        return false;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === TicoRailNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, `Turn`);
            }

            if (this.isGreaterEqualStepAndRandom(60))
                this.setNerve(TicoRailNrv.LookAround);
        } else if (currentNerve === TicoRailNrv.LookAround) {
            if (isFirstStep(this)) {
                tryStartBck(this, `Turn`);
            }

            calcUpVec(scratchVec3, this);

            let turnAmt;
            if (isLessStep(this, 40))
                turnAmt = 1.2;
            else if (isLessStep(this, 120))
                turnAmt = -1.2;
            else if (isLessStep(this, 160))
                turnAmt = 1.2;
            else
                turnAmt = 0.0;
            turnAmt *= getDeltaTimeFrames(viewerInput);
            rotateVecDegree(this.direction, scratchVec3, turnAmt);

            if (isGreaterStep(this, 160)) {
                const rnd = getRandomInt(0, 2);
                if (rnd === 0)
                    this.setNerve(TicoRailNrv.MoveSignAndTurn);
                else
                    this.setNerve(TicoRailNrv.MoveSign);
            }
        } else if (currentNerve === TicoRailNrv.MoveSign || currentNerve === TicoRailNrv.MoveSignAndTurn) {
            if (isFirstStep(this)) {
                startBck(this, `Spin`);

                if (currentNerve === TicoRailNrv.MoveSignAndTurn)
                    reverseRailDirection(this);
            }

            const duration = getBckFrameMax(this);
            const rate = calcNerveRate(this, duration);

            getRailDirection(scratchVec3a, this);
            vec3.negate(scratchVec3b, scratchVec3a);
            vec3.lerp(this.direction, scratchVec3b, scratchVec3a, rate);

            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Move);
        } else if (currentNerve === TicoRailNrv.Move) {
            if (isFirstStep(this)) {
                tryStartBck(this, `Wait`);
            }

            const speed = getDeltaTimeFrames(viewerInput) * calcNerveValue(this, 0, 200, 15);
            moveCoordAndFollowTrans(this, speed);

            getRailDirection(this.direction, this);
            if (this.isGreaterEqualStepAndRandom(500))
                this.setNerve(TicoRailNrv.Stop);
        } else if (currentNerve === TicoRailNrv.Stop) {
            if (isFirstStep(this))
                startBck(this, `Spin`);

            const duration = getBckFrameMax(this);
            const speed = getDeltaTimeFrames(viewerInput) * calcNerveValue(this, duration, 15, 0);
            moveCoordAndFollowTrans(this, speed);
            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Wait);
        } else if (currentNerve === TicoRailNrv.TalkCancel) {
            if (isFirstStep(this))
                tryStartBck(this, `Spin`);

            moveCoordAndFollowTrans(this, getDeltaTimeFrames(viewerInput) * 15);
            getRailDirection(this.direction, this);
            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Move);
        } else if (currentNerve === TicoRailNrv.TalkStart) {
            vec3.sub(scratchVec3a, this.talkingActor!.translation, this.translation);
            vec3.normalize(scratchVec3a, scratchVec3a);

            if (isFirstStep(this)) {
                startBck(this, `Spin`);
                getRailDirection(scratchVec3b, this);

                if (vec3.dot(scratchVec3a, scratchVec3b) > 0)
                    reverseRailDirection(this);
            }

            moveCoordAndFollowTrans(this, getDeltaTimeFrames(viewerInput) * 2);
            const frameMax = getBckFrameMax(this);
            const rate = calcNerveRate(this, frameMax);
            getRailDirection(scratchVec3b, this);
            vec3.lerp(this.direction, scratchVec3b, scratchVec3a, rate);

            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Talk);
        } else if (currentNerve === TicoRailNrv.Talk) {
            if (isFirstStep(this))
                startBck(this, `Talk`);
            if (!isBckPlaying(this, `Reaction`) && getRandomInt(0, 60) === 0)
                startBckWithInterpole(this, `Reaction`, 5);
            if (isBckOneTimeAndStopped(this))
                startBck(this, `Talk`);
            if (isGreaterStep(this, 320))
                this.setNerve(TicoRailNrv.GoodBye);
        } else if (currentNerve === TicoRailNrv.GoodBye) {
            if (isFirstStep(this)) {
                startBck(this, `CallBack`);
                getRailDirection(scratchVec3a, this);
                if (vec3.dot(this.direction, scratchVec3a) > 0)
                    reverseRailDirection(this);
            }
            moveCoordAndFollowTrans(this, getDeltaTimeFrames(viewerInput) * 1.5);
            // TODO(jstpierre): isBckLooped
            const endFrame = getBckFrameMax(this);
            if (isGreaterStep(this, endFrame)) {
                this.talkingActor = null;
                this.setNerve(TicoRailNrv.MoveSign);
            }
        }
    }

    public isStopped(step: number): boolean {
        return this.getCurrentNerve() === TicoRailNrv.Wait && isGreaterStep(this, step);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Tico');
    }
}

export class SubmarineSteam extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));

        emitEffect(sceneObjHolder, this, 'Steam');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }
}

const enum PalmIslandNrv { Wait, Float }

export class PalmIsland extends LiveActor<PalmIslandNrv> {
    private floatDelay: number;
    private rippleTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'PalmIsland');
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.floatDelay = getRandomInt(0, 60);

        this.initNerve(PalmIslandNrv.Wait);

        calcUpVec(this.gravityVector, this);
        vec3.negate(this.gravityVector, this.gravityVector);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === PalmIslandNrv.Wait) {
            if (isGreaterStep(this, this.floatDelay))
                this.setNerve(PalmIslandNrv.Float);
        } else if (currentNerve === PalmIslandNrv.Float) {
            if (isFirstStep(this)) {
                vec3.copy(this.rippleTranslation, this.translation);
                emitEffect(sceneObjHolder, this, 'Ripple');
                setEffectHostSRT(this, 'Ripple', this.rippleTranslation, null, null);
            }

            const theta = MathConstants.DEG_TO_RAD * (90 + 1.44 * this.getNerveStep());
            const waveAmpl = Math.sin(theta) * 1.44;
            vec3.scale(this.velocity, this.gravityVector, waveAmpl);
        }
    }
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

function compareVec3(a: vec3, b: vec3): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
}

// This is kept as a separate class to make cleanup easier.
class WarpPodPathDrawer {
    private testColor: BTIData;
    private testMask: BTIData;
    private materialHelper: GXMaterialHelperGfx;
    private ddraw: TDDraw;

    constructor(sceneObjHolder: SceneObjHolder, arc: RARC.RARC, private points: vec3[], private color: Color) {
        this.testColor = loadBTIData(sceneObjHolder, arc, `TestColor.bti`);
        this.testMask = loadBTIData(sceneObjHolder, arc, `TestMask.bti`);

        this.ddraw = new TDDraw();
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        // Material.
        const mb = new GXMaterialBuilder('WarpPodPathDrawer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CombineColorInput.C0, GX.CombineColorInput.ONE, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.KONST, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    private drawPathPart(camera: Camera, cross: boolean): void {
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.points.length - 1; i++) {
            vec3.sub(scratchVec3a, this.points[i + 1], this.points[i]);
            getCamZdir(scratchVec3b, camera);
            vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3c, scratchVec3c);

            vec3.cross(scratchVec3a, scratchVec3c, scratchVec3b);

            if (cross) {
                vec3.normalize(scratchVec3a, scratchVec3a);
                vec3.cross(scratchVec3a, scratchVec3a, scratchVec3c);
            }
    
            normToLength(scratchVec3a, 30);

            const texCoordY = Math.abs((2.0 * (i / this.points.length)) - 1.0);

            vec3.add(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, texCoordY);

            vec3.sub(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, texCoordY);
        }
        this.ddraw.end();
    }

    private drawPath(camera: Camera): void {
        this.drawPathPart(camera, false);
        this.drawPathPart(camera, true);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.testColor.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color);

        const template = renderInstManager.pushTemplateRenderInst();

        const offs = template.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        this.materialHelper.fillMaterialParamsDataOnInst(template, offs, materialParams);

        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        template.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(template.mapUniformBufferF32(ub_PacketParams), template.getUniformBufferOffset(ub_PacketParams), packetParams);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        this.ddraw.beginDraw();
        this.drawPath(viewerInput.camera);
        this.ddraw.endDraw(device, renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export class WarpPod extends LiveActor {
    private visible: boolean;
    private groupId: number;
    private pairedWarpPod: WarpPod | null = null;
    private isPairPrimary: boolean = false;
    private warpPathPoints: vec3[] | null = null;
    private pathDrawer: WarpPodPathDrawer | null = null;
    private color: Color;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WarpPod");

        this.visible = fallback(getJMapInfoArg1(infoIter), 1) !== 0;
        const hasSaveFlag = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        const astroDomeNum = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        const colorIndex = fallback(getJMapInfoArg6(infoIter), 0);
        
        let color = warpPodColorTable[colorIndex];
        if (color === undefined) {
            // Seems to happen in SMG2 sometimes; they might have expanded the color table.
            color = warpPodColorTable[0];
        }
        this.color = color;

        this.initEffectKeeper(sceneObjHolder, null);

        if (this.visible) {
            startBck(this, 'Active');
            startBrk(this, 'Active');
            // This is a bit hokey, but we don't have an XanimePlayer, so this is our solution...
            setLoopMode(this, LoopMode.ONCE);
        }

        // The game normally will check a few different save file bits
        // or the highest unlocked AstroDome, but we just declare all
        // WarpPods are active.
        const inactive = false;

        if (inactive) {
            startBck(this, 'Wait');
            startBrk(this, 'Wait');
        } else {
            this.glowEffect(sceneObjHolder);
        }

        this.groupId = assertExists(getJMapInfoGroupId(infoIter));
        // Look for the pair. If it's spawned, then init.
        const pairedWarpPod = this.lookForPair(sceneObjHolder);
        if (pairedWarpPod !== null) {
            this.initPair(sceneObjHolder, pairedWarpPod);
            pairedWarpPod.initPair(sceneObjHolder, this);
        }

        // This isn't quite the same as original, which has a WarpPodMgr which draws all of the paths...
        if (this.visible) {
            connectToScene(sceneObjHolder, this, 0x22, 5, DrawBufferType.MAP_OBJ, DrawType.WARP_POD_PATH);
        } else {
            connectToScene(sceneObjHolder, this, 0x22, -1, -1, -1);
        }
    }

    private initPair(sceneObjHolder: SceneObjHolder, pairedWarpPod: WarpPod): void {
        this.pairedWarpPod = pairedWarpPod;

        // The primary pod is whichever of the two has the lowest translation.
        this.isPairPrimary = compareVec3(this.translation, this.pairedWarpPod.translation) < 0;

        if (this.isPairPrimary)
            this.initDraw(sceneObjHolder);
    }

    private initDraw(sceneObjHolder: SceneObjHolder): void {
        if (this.pairedWarpPod === null || !this.isPairPrimary)
            return;

        const numPoints = 60;
        this.warpPathPoints = [];

        const delta = vec3.create();
        vec3.sub(delta, this.pairedWarpPod.translation, this.translation);
        const mag = vec3.length(delta);

        const upVec = vec3.create();
        calcUpVec(upVec, this);
        const negUpVec = vec3.create();
        vec3.negate(negUpVec, upVec);

        const crossA = vec3.create(), crossB = vec3.create();
        vec3.cross(crossA, delta, negUpVec);
        vec3.normalize(crossA, crossA);
        vec3.cross(crossB, crossA, delta);
        vec3.normalize(crossB, crossB);

        const halfway = vec3.create();
        vec3.scale(halfway, delta, 0.5);
        vec3.add(halfway, this.translation, halfway);

        const mag2 = 0.5 * mag;
        const b = mag2 / Math.sin(MathConstants.TAU / 8);
        let a = (b * b) - (mag2 * mag2);
        if (a >= 0) {
            const norm = 1 / Math.sqrt(a);
            const anorm = a * norm;
            const cubic = (anorm * norm) - 3.0;
            a = -cubic * anorm * 0.5;
        }

        const ca = vec3.create(), cb = vec3.create();
        vec3.scaleAndAdd(ca, halfway, crossB, a);
        vec3.scale(cb, crossB, -b);

        for (let i = 0; i < numPoints; i++) {
            const v = vec3.create();
            const ha = 1.0 - ((i - numPoints / 2) / numPoints);
            const c = (Math.sin(Math.PI * ha) + 1.0) * 0.5;
            const rad = lerp(-MathConstants.TAU / 8, MathConstants.TAU / 8, c);
            mat4.fromRotation(scratchMatrix, rad, crossA);

            vec3.transformMat4(v, cb, scratchMatrix);
            vec3.add(v, v, ca);
            vec3.scaleAndAdd(v, v, upVec, 200);

            this.warpPathPoints.push(v);
        }

        this.pathDrawer = new WarpPodPathDrawer(sceneObjHolder, this.resourceHolder.arc, this.warpPathPoints, this.color);
    }

    private lookForPair(sceneObjHolder: SceneObjHolder): WarpPod | null {
        // In the original code, there's a WarpPodMgr which manages a LiveActorGroup
        // so we don't need to search the whole thing.
        for (let i = 0; i < sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++) {
            const nameObj = sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj;
            if (nameObj !== this && nameObj instanceof WarpPod) {
                const warpPod = nameObj as WarpPod;
                if (warpPod.groupId === this.groupId)
                    return warpPod;
            }
        }

        return null;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        if (this.pathDrawer !== null)
            this.pathDrawer.draw(sceneObjHolder.modelCache.device, renderInstManager, viewerInput);
    }

    private glowEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.visible) {
            emitEffect(sceneObjHolder, this, 'EndGlow');
            setEffectEnvColor(this, 'EndGlow', this.color);
        }
    }
    
    public destroy(device: GfxDevice): void {
        super.destroy(device);

        if (this.pathDrawer !== null)
            this.pathDrawer.destroy(device);
    }
}

export class WaterPlantDrawInit extends NameObj {
    public angle: number = 0;
    public swingSpeed: number = 0.03;
    public swingWidth: number = 20;
    public swingPoints: number[] = nArray(64, () => 0);
    public waterPlantA: BTIData;
    public waterPlantB: BTIData;
    public waterPlantC: BTIData;
    public waterPlantD: BTIData;
    public materialHelper: GXMaterialHelperGfx;
    public drawVec = vec3.create();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterPlantDrawInit');

        connectToScene(sceneObjHolder, this, 0x22, -1, -1, -1);

        const arc = sceneObjHolder.modelCache.getObjectData('WaterPlant')!;
        this.waterPlantA = loadBTIData(sceneObjHolder, arc, `WaterPlantA.bti`);
        this.waterPlantB = loadBTIData(sceneObjHolder, arc, `WaterPlantB.bti`);
        this.waterPlantC = loadBTIData(sceneObjHolder, arc, `WaterPlantC.bti`);
        this.waterPlantD = loadBTIData(sceneObjHolder, arc, `WaterPlantD.bti`);

        const mb = new GXMaterialBuilder(`WaterPlant`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        this.updateSwingPos();
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        this.updateSwingPos();
        this.angle += this.swingSpeed * getDeltaTimeFrames(viewerInput);

        const viewMtxInv = viewerInput.camera.worldMatrix;
        vec3.set(this.drawVec, viewMtxInv[0], viewMtxInv[1], viewMtxInv[2]);
    }

    private updateSwingPos(): void {
        let theta = this.angle;
        for (let i = 0; i < this.swingPoints.length; i++) {
            this.swingPoints[i] = Math.sin(theta) * this.swingWidth;
            theta += 0.2;
        }
    }

    public loadTex(m: TextureMapping, plantType: number): void {
        if (plantType === 0)
            this.waterPlantA.fillTextureMapping(m);
        else if (plantType === 1)
            this.waterPlantB.fillTextureMapping(m);
        else if (plantType === 2)
            this.waterPlantC.fillTextureMapping(m);
        else if (plantType === 3)
            this.waterPlantD.fillTextureMapping(m);
        else
            throw "whoops";
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.waterPlantA.destroy(device);
        this.waterPlantB.destroy(device);
        this.waterPlantC.destroy(device);
        this.waterPlantD.destroy(device);
    }
}

class WaterPlantData {
    public position = vec3.create();
    public axisZ = vec3.create();
    public height: number = 0;
    public swingPosIdx0: number = 0;
    public swingPosIdx1: number = 0;
    public swingPosIdx2: number = 0;
}

const waterPlantHeightTable = [150, 200, 300, 250];
export class WaterPlant extends LiveActor {
    private plantCount: number;
    private radius: number;
    private plantType: number;
    private height: number;
    private plantData: WaterPlantData[] = [];
    private ddraw = new TDDraw();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.WATER_PLANT_DRAW_INIT);

        connectToScene(sceneObjHolder, this, 0x22, -1, -1, DrawType.WATER_PLANT);
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.plantCount = fallback(getJMapInfoArg0(infoIter), 0x16);
        this.radius = fallback(getJMapInfoArg1(infoIter), 500);
        this.plantType = fallback(getJMapInfoArg3(infoIter), 0);
        this.height = waterPlantHeightTable[this.plantType];

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.POS_XYZ);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        computeModelMatrixR(scratchMatrix, 0, 15.0 * MathConstants.DEG_TO_RAD, 0);

        // Scatter the plants around.
        const axisZ = scratchVec3;
        let swingPosIdx = 0;
        vec3.set(axisZ, 0, 0, 1);
        for (let i = 0; i < this.plantCount; i++) {
            const plantData = new WaterPlantData();

            // TODO(jstpierre): Search for ground. For now, just scatter them around on XZ plane.
            const x = getRandomFloat(-this.radius, this.radius);
            const z = getRandomFloat(-this.radius, this.radius);
            vec3.copy(plantData.position, this.translation);
            plantData.position[0] += x;
            plantData.position[2] += z;

            vec3.copy(plantData.axisZ, axisZ);

            plantData.height = getRandomFloat(this.height, 2.0 * this.height);
            plantData.swingPosIdx0 = swingPosIdx + 6;
            plantData.swingPosIdx1 = swingPosIdx + 3;
            plantData.swingPosIdx2 = swingPosIdx;
            swingPosIdx = (swingPosIdx + 60) % 57;

            vec3.transformMat4(axisZ, axisZ, scratchMatrix);

            this.plantData.push(plantData);
        }
    }

    private drawStrip(ddraw: TDDraw, v0: vec3, dx: number, dz: number, tx: number): void {
        ddraw.position3f32(v0[0] - dx, v0[1], v0[2] - dz);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, tx);
        ddraw.position3f32(v0[0] + dx, v0[1], v0[2] + dz);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, tx);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        const waterPlantDrawInit = sceneObjHolder.waterPlantDrawInit!;

        this.ddraw.beginDraw();

        for (let i = 0; i < this.plantData.length; i++) {
            const plantData = this.plantData[i];
            vec3.scaleAndAdd(scratchVec3a, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx0]);
            vec3.scaleAndAdd(scratchVec3b, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx1]);
            vec3.scaleAndAdd(scratchVec3c, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx2]);

            scratchVec3a[1] += plantData.height * 0.5;
            scratchVec3b[1] += plantData.height * 0.8;
            scratchVec3c[1] += plantData.height * 1.0;

            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            this.ddraw.allocVertices(8);

            const dx = waterPlantDrawInit.drawVec[0] * 20.0;
            const dz = waterPlantDrawInit.drawVec[2] * 20.0;

            this.drawStrip(this.ddraw, scratchVec3c, dx, dz, 0.0);
            this.drawStrip(this.ddraw, scratchVec3b, dx, dz, 0.2);
            this.drawStrip(this.ddraw, scratchVec3a, dx, dz, 0.5);
            this.drawStrip(this.ddraw, plantData.position, dx, dz, 1.0);

            this.ddraw.end();
        }

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(device, renderInstManager);

        waterPlantDrawInit.loadTex(materialParams.m_TextureMapping[0], this.plantType);
        const materialHelper = waterPlantDrawInit.materialHelper;
        const offs = renderInst.allocateUniformBuffer(ub_MaterialParams, materialHelper.materialParamsBufferSize);
        materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.ddraw.destroy(device);
    }
}

export class StarPieceGroup extends LiveActor {
    private starPieces: StarPiece[] = [];
    private isConnectedWithRail: boolean = false;
    private spawnOnRailPoints: boolean = false;
    private radius: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        let starPieceCount = 6;

        // TODO(jstpierre): StarPieceFlow
        starPieceCount = fallback(getJMapInfoArg0(infoIter), starPieceCount);
        this.radius = fallback(getJMapInfoArg1(infoIter), 400);
        const arg2 = fallback(getJMapInfoArg2(infoIter), -1);

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.isConnectedWithRail = true;

            if (arg2 === 1) {
                starPieceCount = getRailPointNum(this);
                this.spawnOnRailPoints = true;
            }
        }

        for (let i = 0; i < starPieceCount; i++) {
            const starPiece = new StarPiece(zoneAndLayer, sceneObjHolder, null);
            initDefaultPos(sceneObjHolder, starPiece, infoIter);
            this.starPieces.push(starPiece);
        }

        this.placementAllPiece();
    }

    private placementAllPiece(): void {
        if (!this.isConnectedWithRail)
            this.placementPieceOnCircle();
        else if (this.spawnOnRailPoints)
            this.placementPieceOnRailPoint();
        else
            this.placementPieceOnRail();
    }

    private placementPieceOnCircle(): void {
        if (this.starPieces.length === 1) {
            vec3.copy(this.starPieces[0].translation, this.translation);
        } else {
            makeMtxTRFromActor(scratchMatrix, this);
            calcMtxAxis(scratchVec3a, null, scratchVec3b, scratchMatrix);

            for (let i = 0; i < this.starPieces.length; i++) {
                const starPiece = this.starPieces[i];
                const theta = MathConstants.TAU * (i / this.starPieces.length);
                vec3.scaleAndAdd(starPiece.translation, starPiece.translation, scratchVec3a, Math.cos(theta) * this.radius);
                vec3.scaleAndAdd(starPiece.translation, starPiece.translation, scratchVec3b, Math.sin(theta) * this.radius);
            }
        }
    }

    private placementPieceOnRailPoint(): void {
        assert(this.starPieces.length === getRailPointNum(this));
        for (let i = 0; i < this.starPieces.length; i++)
            calcRailPointPos(this.starPieces[i].translation, this, i);
    }

    private placementPieceOnRail(): void {
        const totalRailLength = getRailTotalLength(this);

        let speed = 0.0;
        if (this.starPieces.length > 1) {
            let denom = this.starPieces.length;
            if (!isLoopRail(this))
                denom -= 1;

            speed = totalRailLength / denom;
        }

        let coord = 0;
        for (let i = 0; i < this.starPieces.length; i++) {
            calcRailPosAtCoord(this.starPieces[i].translation, this, coord);
            coord += speed;
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('StarPiece');
    }
}

const enum ShellfishNrv { Wait, Open, OpenWait, CloseSignal, Close }

const shellfishChipOffset = vec3.fromValues(0, 100, 50);
const shellfishCoinOffset = vec3.fromValues(0, 50, 30);
export class Shellfish extends LiveActor<ShellfishNrv> {
    private item: LiveActor;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Shellfish');
        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
        this.initItem(sceneObjHolder);
        this.initNerve(ShellfishNrv.Wait);
    }

    private initItem(sceneObjHolder: SceneObjHolder): void {
        if (this.name === 'ShellfishCoin')
            this.initCoin(sceneObjHolder);
        else if (this.name === 'ShellfishYellowChip')
            this.initYellowChip(sceneObjHolder);
    }

    private initCoin(sceneObjHolder: SceneObjHolder): void {
        this.item = new Coin(this.zoneAndLayer, sceneObjHolder, null, false);
        const mtx = this.getBaseMtx()!;
        vec3.transformMat4(this.item.translation, shellfishCoinOffset, mtx);
    }

    private initYellowChip(sceneObjHolder: SceneObjHolder): void {
        this.item = new YellowChip(this.zoneAndLayer, sceneObjHolder, null);
        const mtx = this.getBaseMtx()!;
        vec3.transformMat4(this.item.translation, shellfishChipOffset, mtx);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const currentNerve = this.getCurrentNerve();
        if (currentNerve === ShellfishNrv.Wait) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            if (isFirstStep(this))
                this.setNerve(ShellfishNrv.Open);
        } else if (currentNerve === ShellfishNrv.Open) {
            if (isFirstStep(this))
                startBck(this, 'Open');

            if (isGreaterStep(this, 100))
                this.setNerve(ShellfishNrv.OpenWait);
        } else if (currentNerve === ShellfishNrv.OpenWait) {
            if (isGreaterStep(this, 170))
                this.setNerve(ShellfishNrv.CloseSignal);
        } else if (currentNerve === ShellfishNrv.CloseSignal) {
            if (isFirstStep(this))
                startBck(this, 'CloseSignal');

            if (isGreaterStep(this, 150))
                this.setNerve(ShellfishNrv.Close);
        } else if (currentNerve === ShellfishNrv.Close) {
            if (isFirstStep(this))
                startBck(this, 'Close');

            if (isBckStopped(this))
                this.setNerve(ShellfishNrv.Wait);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Shellfish');
    }
}

export class PunchBox extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'PunchBox');
        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
    }
}

export class ChooChooTrain extends LiveActor {
    private trainBodies: ModelObj[] = [];
    private speed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'ChooChooTrain');
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        const numTrainBodies = fallback(getJMapInfoArg0(infoIter), 3);
        this.speed = fallback(getJMapInfoArg1(infoIter), 5);

        for (let i = 0; i < numTrainBodies; i++) {
            const trainBody = new ModelObj(zoneAndLayer, sceneObjHolder, 'ChooChooTrainBody', 'ChooChooTrainBody', null, -2, 0x1E, 2);
            this.trainBodies.push(trainBody);
        }

        moveCoordAndTransToNearestRailPos(this);
        const coord = getRailCoord(this);

        reverseRailDirection(this);

        for (let i = 0; i < this.trainBodies.length; i++) {
            moveCoord(this, 1080 * this.scale[1]);
            moveTransToOtherActorRailPos(this.trainBodies[i], this);
            startBck(this.trainBodies[i], 'Run');
        }

        setRailCoord(this, coord);
        startBck(this, 'Run');
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        moveCoordAndFollowTrans(this, this.speed);

        getRailDirection(scratchVec3a, this);
        const angle = Math.atan2(scratchVec3a[2], scratchVec3a[0]);
        this.rotation[1] = -angle + MathConstants.TAU / 4;

        const coord = getRailCoord(this);
        reverseRailDirection(this);

        for (let i = 0; i < this.trainBodies.length; i++) {
            const body = this.trainBodies[i];
            moveCoord(this, 1080 * this.scale[1]);
            moveTransToOtherActorRailPos(body, this);
            getRailDirection(scratchVec3a, this);
            const angle = Math.atan2(scratchVec3a[2], scratchVec3a[0]);
            body.rotation[1] = -angle - MathConstants.TAU / 4;
        }

        reverseRailDirection(this);

        setRailCoord(this, coord);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('ChooChooTrainBody');
    }
}

class SwingRopePoint {
    public position = vec3.create();
    public accel = vec3.create();
    public axisX = vec3.fromValues(1, 0, 0);
    public axisY = vec3.fromValues(0, 1, 0);
    public axisZ = vec3.fromValues(0, 0, 1);

    constructor(position: vec3) {
        vec3.copy(this.position, position);
    }

    public updatePos(drag: number): void {
        vec3.add(this.position, this.position, this.accel);
        vec3.scale(this.accel, this.accel, drag);
    }

    public updateAxis(axisZ: vec3): void {
        vec3.cross(this.axisX, this.axisY, axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisZ, this.axisX, this.axisY);
        vec3.normalize(this.axisZ, this.axisZ);
    }

    public updatePosAndAxis(axisZ: vec3, drag: number): void {
        this.updatePos(drag);
        this.updateAxis(axisZ);
    }
}

export class SwingRopeGroup extends NameObj {
    public swingRope: BTIData;
    public materialHelper: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SwingRopeGroup');

        const arc = sceneObjHolder.modelCache.getObjectData('SwingRope')!;
        this.swingRope = loadBTIData(sceneObjHolder, arc, `SwingRope.bti`);

        const mb = new GXMaterialBuilder(`SwingRope`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        // Original code uses a pretty awful alpha compare... we up it a bit to get it looking better...
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.swingRope.destroy(device);
    }
}

const swingRopeColorPlusZ = colorNewFromRGBA8(0xFFFFFFFF);
const swingRopeColorPlusX = colorNewFromRGBA8(0xFFFFFFFF);
const swingRopeColorMinusX = colorNewFromRGBA8(0xFFFFFFFF);
export class SwingRope extends LiveActor {
    private pos = vec3.create();
    private height: number;
    private ddraw = new TDDraw();
    private swingRopePoints: SwingRopePoint[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.SWING_ROPE_GROUP);
        connectToScene(sceneObjHolder, this, 0x29, -1, -1, DrawType.SWING_ROPE);
        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.pos, this.translation);
        this.height = 100.0 * this.scale[1];
        this.initPoints();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    private initPoints(): void {
        const pointCount = (this.height / 50.0) | 0;

        for (let i = 0; i < pointCount; i++) {
            vec3.scaleAndAdd(scratchVec3a, this.pos, this.gravityVector, 50.0 * (i + 1));
            const p = new SwingRopePoint(scratchVec3a);
            this.swingRopePoints.push(p);
        }
    }

    private sendPoint(v: vec3, axisX: vec3, axisZ: vec3, sx: number, sz: number, color: Color, tx: number, ty: number): void {
        this.ddraw.position3f32(
            v[0] + axisX[0] * sx + axisZ[0] * sz,
            v[1] + axisX[1] * sx + axisZ[1] * sz,
            v[2] + axisX[2] * sx + axisZ[2] * sz,
        );
        this.ddraw.color4color(GX.Attr.CLR0, color);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, tx, ty);
    }

    private drawStop(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.ddraw.beginDraw();
        this.ddraw.allocVertices(12);

        const ty = 0.13 * (this.height / 50.0);

        const p = this.swingRopePoints[0]!;
        vec3.copy(scratchVec3a, this.pos);
        vec3.copy(scratchVec3b, this.pos);
        scratchVec3b[1] -= this.height;

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -30.0,  43.0, swingRopeColorPlusZ,  0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  33.0, -43.0, swingRopeColorPlusX,  1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -30.0,  43.0, swingRopeColorPlusZ,  0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  33.0, -43.0, swingRopeColorPlusX,  1.0, ty);
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -33.0, -43.0, swingRopeColorMinusX, 0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  30.0,  43.0, swingRopeColorPlusZ,  1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -33.0, -43.0, swingRopeColorMinusX, 0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  30.0,  43.0, swingRopeColorPlusZ,  1.0, ty);
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  43.0,  -3.0, swingRopeColorPlusX,  0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -43.0,  -3.0, swingRopeColorMinusX, 1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  43.0,  -3.0, swingRopeColorPlusX,  0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -43.0,  -3.0, swingRopeColorMinusX, 1.0, ty);
        this.ddraw.end();

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(device, renderInstManager);

        const swingRopeGroup = sceneObjHolder.swingRopeGroup!;
        swingRopeGroup.swingRope.fillTextureMapping(materialParams.m_TextureMapping[0]);
        const materialHelper = swingRopeGroup.materialHelper;
        const offs = renderInst.allocateUniformBuffer(ub_MaterialParams, materialHelper.materialParamsBufferSize);
        materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);
        this.drawStop(sceneObjHolder, renderInstManager, viewerInput);
    }
}

export class TrapezeRopeDrawInit extends NameObj {
    public trapezeRope: BTIData;
    public materialHelper: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'TrapezeRopeDrawInit');

        const arc = sceneObjHolder.modelCache.getObjectData('Trapeze')!;
        this.trapezeRope = loadBTIData(sceneObjHolder, arc, `TrapezeRope.bti`);

        const mb = new GXMaterialBuilder(`TrapezeRope`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CombineColorInput.ZERO, GX.CombineColorInput.TEXC, GX.CombineColorInput.RASC, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        // Original code uses a pretty awful alpha compare... we up it a bit to get it looking better...
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.trapezeRope.destroy(device);
    }
}

const trapezeColorPlusZ = colorNewFromRGBA8(0xFFFFFFFF);
const trapezeColorPlusX = colorNewFromRGBA8(0xB4B4B4FF);
const trapezeColorMinusX = colorNewFromRGBA8(0x646464FF);
export class Trapeze extends LiveActor {
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private swingRopePoint: SwingRopePoint;
    private stick: PartsModel;
    private stickMtx = mat4.create();
    private ddraw = new TDDraw();
    private height: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.TRAPEZE_ROPE_DRAW_INIT);
        connectToScene(sceneObjHolder, this, 0x29, -1, -1, DrawType.TRAPEZE);
        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(scratchMatrix, this);
        calcMtxAxis(this.axisX, this.axisY, this.axisZ, scratchMatrix);

        this.height = this.scale[1] * 100.0;
        vec3.set(this.scale, 1.0, 1.0, 1.0);

        vec3.set(scratchVec3, this.translation[0], this.translation[1] - this.height, this.translation[2]);
        this.swingRopePoint = new SwingRopePoint(scratchVec3);
        this.swingRopePoint.updatePosAndAxis(this.axisZ, 0.995);

        // I think this is a bug in the original game -- it uses ENEMY rather than RIDE?
        this.stick = new PartsModel(sceneObjHolder, 'TrapezeStick', 'Trapeze', this, DrawBufferType.ENEMY, this.stickMtx);
        this.updateStickMtx();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    private drawRope(top: vec3, bottom: vec3, axisX: vec3, axisZ: vec3, txc0: number, txc1: number): void {
        this.ddraw.allocVertices(12);

        // Rope 1.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] - 12.0 * axisX[0] + 19.0 * axisZ[0],
            top[1] - 12.0 * axisX[1] + 19.0 * axisZ[1],
            top[2] - 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, txc0);

        this.ddraw.position3f32(
            top[0] + 19.0 * axisX[0] - 19.0 * axisZ[0],
            top[1] + 19.0 * axisX[1] - 19.0 * axisZ[1],
            top[2] + 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, txc0);

        this.ddraw.position3f32(
            bottom[0] - 12.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] - 12.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] - 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, txc1);

        this.ddraw.position3f32(
            bottom[0] + 19.0 * axisX[0] - 19.0 * axisZ[0],
            bottom[1] + 19.0 * axisX[1] - 19.0 * axisZ[1],
            bottom[2] + 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, txc1);

        this.ddraw.end();

        // Rope 2.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] - 19.0 * axisX[0] - 19.0 * axisZ[0],
            top[1] - 19.0 * axisX[1] - 19.0 * axisZ[1],
            top[2] - 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.7 + txc0);

        this.ddraw.position3f32(
            top[0] + 12.0 * axisX[0] + 19.0 * axisZ[0],
            top[1] + 12.0 * axisX[1] + 19.0 * axisZ[1],
            top[2] + 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.7 + txc0);

        this.ddraw.position3f32(
            bottom[0] - 19.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] - 19.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] - 19.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.7 + txc1);

        this.ddraw.position3f32(
            bottom[0] + 12.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] + 12.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] + 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.7 + txc1);

        this.ddraw.end();
        
        // Rope 3.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] + 19.0 * axisX[0] - 7.0 * axisZ[0],
            top[1] + 19.0 * axisX[1] - 7.0 * axisZ[1],
            top[2] + 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.5 + txc0);

        this.ddraw.position3f32(
            top[0] - 19.0 * axisX[0] - 7.0 * axisZ[0],
            top[1] - 19.0 * axisX[1] - 7.0 * axisZ[1],
            top[2] - 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.5 + txc0);

        this.ddraw.position3f32(
            bottom[0] + 19.0 * axisX[0] - 7.0 * axisZ[0],
            bottom[1] + 19.0 * axisX[1] - 7.0 * axisZ[1],
            bottom[2] + 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.5 + txc1);

        this.ddraw.position3f32(
            bottom[0] - 19.0 * axisX[0] - 7.0 * axisZ[0],
            bottom[1] - 19.0 * axisX[1] - 7.0 * axisZ[1],
            bottom[2] - 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.5 + txc1);

        this.ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        this.ddraw.beginDraw();

        // Neg
        vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisX, -60.0);
        vec3.scaleAndAdd(scratchVec3b, this.swingRopePoint.position, this.axisX, -60.0);
        this.drawRope(scratchVec3a, scratchVec3b, this.swingRopePoint.axisX, this.swingRopePoint.axisZ, 0.0, 0.003 * this.height);

        // Pos
        vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisX, 60.0);
        vec3.scaleAndAdd(scratchVec3b, this.swingRopePoint.position, this.axisX, 60.0);
        this.drawRope(scratchVec3a, scratchVec3b, this.swingRopePoint.axisX, this.swingRopePoint.axisZ, 0.0, 0.003 * this.height);

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(device, renderInstManager);

        const trapezeRopeDrawInit = sceneObjHolder.trapezeRopeDrawInit!;
        trapezeRopeDrawInit.trapezeRope.fillTextureMapping(materialParams.m_TextureMapping[0]);
        const materialHelper = trapezeRopeDrawInit.materialHelper;
        const offs = renderInst.allocateUniformBuffer(ub_MaterialParams, materialHelper.materialParamsBufferSize);
        materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    }

    private updateStickMtx(): void {
        const point = this.swingRopePoint;
        setMtxAxisXYZ(this.stickMtx, point.axisX, point.axisY, point.axisZ);
        setTrans(this.stickMtx, point.position);
    }
}
