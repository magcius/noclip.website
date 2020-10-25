
import { mat4, quat, ReadonlyMat4, ReadonlyQuat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { clamp, computeEulerAngleRotationFromSRTMatrix, computeModelMatrixR, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, isNearZero, isNearZeroVec3, MathConstants, normToLength, normToLengthAndAdd, quatFromEulerRadians, saturate, setMatrixTranslation, transformVec3Mat4w0, Vec3Zero } from '../../MathHelpers';
import { assertExists, fallback, nArray } from '../../util';
import * as Viewer from '../../viewer';
import { addBodyMessageSensorMapObjPress, addHitSensor, addHitSensorEye, addVelocityMoveToDirection, addVelocityToGravity, attenuateVelocity, blendQuatUpFront, calcGravity, calcGravityVector, calcMtxFromGravityAndZAxis, calcPerpendicFootToLine, calcRailPointPos, calcSqDistanceToPlayer, connectToSceneCollisionEnemyNoShadowedMapObjStrongLight, connectToSceneCollisionEnemyStrongLight, connectToSceneEnemy, connectToSceneEnemyMovement, connectToSceneIndirectEnemy, excludeCalcShadowToMyCollision, getBckFrameMax, getBrkFrameMax, getCamYdir, getCamZdir, getCurrentRailPointArg0, getEaseInOutValue, getEaseInValue, getGroupFromArray, getPlayerPos, getRailPointNum, getRandomInt, getRandomVector, hideModel, initCollisionParts, initDefaultPos, invalidateHitSensors, invalidateShadowAll, isActionEnd, isBckPlaying, isBckStopped, isBrkStopped, isBtpStopped, isHiddenModel, isNearPlayer, isNearPlayerPose, isOnSwitchA, isSameDirection, isValidSwitchA, isValidSwitchB, isValidSwitchDead, joinToGroupArray, listenStageSwitchOnOffA, listenStageSwitchOnOffB, makeMtxFrontUp, makeMtxFrontUpPos, makeMtxTRFromQuatVec, makeMtxUpFront, makeMtxUpFrontPos, makeMtxUpNoSupportPos, moveCoordAndTransToRailStartPoint, moveCoordToRailPoint, quatGetAxisX, quatGetAxisY, quatGetAxisZ, quatSetRotate, reboundVelocityFromCollision, reboundVelocityFromEachCollision, restrictVelocity, rotateQuatRollBall, setBckFrameAndStop, setBckRate, setBrkFrameAndStop, setBvaRate, setRailDirectionToEnd, showModel, startAction, startBck, startBckNoInterpole, startBckWithInterpole, startBpk, startBrk, startBtp, startBva, syncStageSwitchAppear, tryStartBck, turnVecToVecCos, turnVecToVecCosOnPlane, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB, useStageSwitchWriteDead, validateHitSensors, validateShadowAll, vecKillElement } from '../ActorUtil';
import { CollisionKeeperCategory, getFirstPolyOnLineToMapExceptSensor, isBinded, isBindedGround, isBindedRoof, isBindedWall, isGroundCodeDamage, isGroundCodeDamageFire, isOnGround, Triangle, TriangleFilterFunc } from '../Collision';
import { deleteEffect, deleteEffectAll, emitEffect, isEffectValid, setEffectHostMtx } from '../EffectSystem';
import { initFur } from '../Fur';
import { HitSensor, HitSensorType, isSensorEnemy, isSensorNear, isSensorPlayerOrRide, sendMsgEnemyAttack, sendMsgEnemyAttackExplosion, sendMsgToGroupMember } from '../HitSensor';
import { getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoBool, JMapInfoIter } from '../JMapInfo';
import { initLightCtrl } from '../LightData';
import { isDead, LiveActor, makeMtxTRFromActor, MessageType, ZoneAndLayer } from '../LiveActor';
import { getDeltaTimeFrames, getObjectName, SceneObjHolder } from '../Main';
import { isInWater } from '../MiscMap';
import { DrawBufferType } from '../NameObj';
import { getShadowProjectedSensor, getShadowProjectionPos, initShadowFromCSV, initShadowVolumeOval, initShadowVolumeSphere, isShadowProjected, onCalcShadow, setShadowDropLength } from '../Shadow';
import { calcNerveRate, isFirstStep, isGreaterEqualStep, isGreaterStep, isLessStep, NerveExecutor } from '../Spine';
import { isEqualStageName, PartsModel } from './MiscActor';
import { createModelObjBloomModel, createModelObjMapObj, ModelObj } from './ModelObj';

// Scratchpad
const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();
const scratchQuat = quat.create();
function isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder: SceneObjHolder): boolean {
    return sceneObjHolder.scenarioData.scenarioDataIter.getValueString('Comet') === 'Quick';
}

const enum DossunNrv { Upper, FallSign, Falling, OnGround, Rising, }
export class Dossun extends LiveActor<DossunNrv> {
    private upperHeight: number;
    private maxUpperStep: number;
    private maxFallingStep: number;
    private maxRisingStep: number;
    private lowerPos = vec3.create();
    private upperPos = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        // initMapToolInfo
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.upperHeight = fallback(getJMapInfoArg0(infoIter), 1000.0);
        this.maxUpperStep = fallback(getJMapInfoArg1(infoIter), 180);
        vec3.copy(this.lowerPos, this.translation);
        this.initModelManagerWithAnm(sceneObjHolder, 'Dossun');
        startBva(this, 'Wait');

        connectToSceneCollisionEnemyStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        const hitSensor = addBodyMessageSensorMapObjPress(sceneObjHolder, this);
        initCollisionParts(sceneObjHolder, this, 'Dossun', hitSensor);
        this.initEffectKeeper(sceneObjHolder, null);
        // this.initSound();
        const shadowType = fallback(getJMapInfoArg2(infoIter), -1);
        if (shadowType === 0) {
            initShadowFromCSV(sceneObjHolder, this, 'Shadow2D');
        } else if (shadowType === -1) {
            initShadowFromCSV(sceneObjHolder, this);
            excludeCalcShadowToMyCollision(this);
        }
        this.initNerve(DossunNrv.Upper);
        // setClippingTypeSphereContainsModelBoundingBox

        this.calcParameters(sceneObjHolder);
    }

    private calcParameters(sceneObjHolder: SceneObjHolder): void {
        vec3.set(scratchVec3, 0.0, this.upperHeight, 0.0);
        transformVec3Mat4w0(scratchVec3, this.getBaseMtx()!, scratchVec3);
        vec3.add(this.upperPos, this.lowerPos, scratchVec3);

        const fallingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 30.0;
        this.maxFallingStep = this.upperHeight / fallingSpeed;

        const risingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 25.0;
        this.maxRisingStep = this.upperHeight / risingSpeed;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: DossunNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === DossunNrv.Upper) {
            if (isFirstStep(this))
                vec3.copy(this.translation, this.upperPos);

            if (isGreaterStep(this, this.maxUpperStep))
                this.setNerve(DossunNrv.FallSign);
        } else if (currentNerve === DossunNrv.FallSign) {
            if (isFirstStep(this)) {
                startBck(this, 'FallStart');
                startBva(this, 'Attack');

                if (isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder)) {
                    setBckRate(this, 2.5);
                    setBvaRate(this, 2.5);
                }

                // startSound
            }

            if (isBckStopped(this))
                this.setNerve(DossunNrv.Falling);
        } else if (currentNerve === DossunNrv.Falling) {
            const t = getEaseInValue(this.getNerveStep(), 0.0, 1.0, this.maxFallingStep);
            vec3.lerp(this.translation, this.upperPos, this.lowerPos, t);

            // startLevelSound
            if (isGreaterStep(this, this.maxFallingStep))
                this.setNerve(DossunNrv.OnGround);
        } else if (currentNerve === DossunNrv.OnGround) {
            if (isFirstStep(this)) {
                vec3.copy(this.translation, this.lowerPos);
                // startRumbleWithShakeCameraNormalWeak
                // startSound
                emitEffect(sceneObjHolder, this, 'Land');
            }

            const step = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 120 : 48;
            if (isGreaterStep(this, step))
                this.setNerve(DossunNrv.Rising);
        } else if (currentNerve === DossunNrv.Rising) {
            if (isFirstStep(this))
                startBva(this, 'Wait');

            const t = getEaseInOutValue(this.getNerveStep(), 0.0, 1.0, this.maxRisingStep);
            vec3.lerp(this.translation, this.lowerPos, this.upperPos, t);
            // startLevelSound
            if (isGreaterStep(this, this.maxRisingStep)) {
                // startSound
                this.setNerve(DossunNrv.Upper);
            }
        }
    }
}


const enum OnimasuNrv { Wait, Jump, WaitForStamp, Stamp }
abstract class Onimasu extends LiveActor<OnimasuNrv> {
    protected effectHostMtx = mat4.create();

    private rotationAxis = vec3.create();
    private poseQuat = quat.create();
    private poseQuatLast = quat.create();
    private poseQuatNext = quat.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        this.initFromRailPoint(sceneObjHolder);
        this.initModelManagerWithAnm(sceneObjHolder, 'Onimasu');
        connectToSceneCollisionEnemyNoShadowedMapObjStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'Move', this.effectHostMtx);
        // initSound
        this.initHitSensor();
        // addHitSensor
        // initCollisionParts
        // initAndSetRailClipping
        // setGroupClipping
        // addBaseMatrixFollowTarget

        // onCalcGravity()
        this.calcGravityFlag = true;

        // useStageSwitchReadA
        this.initNerve(OnimasuNrv.Wait);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        this.collectRailPointInfo(sceneObjHolder);
        moveCoordAndTransToRailStartPoint(this);
        setRailDirectionToEnd(this);
        this.calcAndSetBaseMtxBase();

        if (isEqualStageName(sceneObjHolder, 'FactoryGalaxy')) {
            getMatrixAxisX(this.rotationAxis, this.modelInstance!.modelMatrix);
            vec3.normalize(this.rotationAxis, this.rotationAxis);
        }

        mat4.getRotation(this.poseQuatLast, this.modelInstance!.modelMatrix);
        quat.copy(this.poseQuatNext, this.poseQuatLast);
        quat.copy(this.poseQuat, this.poseQuatLast);

        if (isEqualStageName(sceneObjHolder, 'FactoryGalaxy')) {
            const turnDirection = this.calcTurnDirection();
            if (turnDirection === -1.0)
                this.setNerve(OnimasuNrv.WaitForStamp);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: OnimasuNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === OnimasuNrv.Wait || currentNerve === OnimasuNrv.WaitForStamp) {
            const step = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 45 : 90;
            if (isGreaterEqualStep(this, step)) {
                if (currentNerve === OnimasuNrv.WaitForStamp)
                    this.setNerve(OnimasuNrv.Stamp);
                else
                    this.setNerve(OnimasuNrv.Jump);
            }
        } else if (currentNerve === OnimasuNrv.Jump) {
            if (isFirstStep(this)) {
                this.incrementNextPoint(sceneObjHolder);
                this.calcTargetPose(sceneObjHolder);
                this.startMoveInner(sceneObjHolder);
            }

            if (isGreaterEqualStep(this, 1))
                this.calcGravityFlag = false;

            this.updatePose(sceneObjHolder);
            this.updatePoseInner(sceneObjHolder, deltaTimeFrames);

            const step = this.getTimeToNextPoint(sceneObjHolder);
            if (isGreaterEqualStep(this, step)) {
                this.land(sceneObjHolder);
                if (this.calcTurnDirection() === -1.0)
                    this.setNerve(OnimasuNrv.WaitForStamp);
                else
                    this.setNerve(OnimasuNrv.Wait);
            }
        } else if (currentNerve === OnimasuNrv.Stamp) {
            if (isFirstStep(this)) {
                this.updateStompVelocity(sceneObjHolder);
            }

            const normal = this.getNextPointNormal();
            const gravityScalar = this.getGravityScalar(sceneObjHolder);
            vec3.scaleAndAdd(this.velocity, this.velocity, normal, -1.0 * gravityScalar * deltaTimeFrames);

            const step = this.getTimeToNextPoint(sceneObjHolder);
            if (isGreaterEqualStep(this, step)) {
                this.land(sceneObjHolder);
                this.setNerve(OnimasuNrv.Wait);
            }
        }
    }

    private calcTargetPose(sceneObjHolder: SceneObjHolder): void {
        const lastNormal = this.getLastPointNormal();
        const nextNormal = this.getNextPointNormal();

        if (!isSameDirection(lastNormal, nextNormal, 0.01)) {
            // Turn between the two normals.
            quat.rotationTo(scratchQuat, lastNormal, nextNormal);
            quat.getAxisAngle(this.rotationAxis, scratchQuat);
            vec3.normalize(this.rotationAxis, this.rotationAxis);
        } else if (this.calcTurnDirection() !== null) {
            // Use the turn direction parameter to figure out how to turn.
            quat.identity(scratchQuat);
            const angle = Math.PI * this.calcTurnDirection()!;
            mat4.fromRotation(scratchMatrix, angle, lastNormal);
            transformVec3Mat4w0(this.rotationAxis, scratchMatrix, this.rotationAxis);
        } else {
            quat.identity(scratchQuat);
            // Use the positions to automatically determine a turn direction.
            // TODO(jstpierre)
        }

        quat.copy(this.poseQuatLast, this.poseQuatNext);
        quat.mul(this.poseQuatNext, scratchQuat, this.poseQuatNext);
        quat.setAxisAngle(scratchQuat, this.rotationAxis, MathConstants.TAU / 4);
        quat.mul(this.poseQuatNext, scratchQuat, this.poseQuatNext);
    }

    private updatePose(sceneObjHolder: SceneObjHolder): void {
        const step = this.getTimeToNextPoint(sceneObjHolder);
        const t = saturate(this.getNerveStep() / step);
        quat.slerp(this.poseQuat, this.poseQuatLast, this.poseQuatNext, t);
    }

    private emitEffectLand(sceneObjHolder: SceneObjHolder): void {
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(scratchVec3, this, nextPointNo);

        const normal = this.getNextPointNormal();
        // Original game does -normal * 800 * 0.5, likely to center.
        vec3.scaleAndAdd(scratchVec3, scratchVec3, normal, -400.0);

        if (isSameDirection(this.rotationAxis, normal, 0.01)) {
            makeMtxUpNoSupportPos(this.effectHostMtx, normal, scratchVec3);
        } else {
            // TODO(jstpierre): makeMtxUpSidePos
            makeMtxUpFrontPos(this.effectHostMtx, normal, this.rotationAxis, scratchVec3);
        }

        emitEffect(sceneObjHolder, this, 'Move');
    }

    private land(sceneObjHolder: SceneObjHolder): void {
        this.emitEffectLand(sceneObjHolder);
        // startRumbleWithShakeCameraNormalWeak
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(this.translation, this, nextPointNo);
        vec3.set(this.velocity, 0, 0, 0);
        moveCoordToRailPoint(this, nextPointNo);
    }

    private updateStompVelocity(sceneObjHolder: SceneObjHolder): void {
        const gravityScalar = this.getGravityScalar(sceneObjHolder);
        const step = this.getTimeToNextPoint(sceneObjHolder);
        const normal = this.getNextPointNormal();
        vec3.scale(this.velocity, normal, 0.5 * gravityScalar * step);
    }

    protected calcTurnDirection(): number | null {
        const arg0 = getCurrentRailPointArg0(this);
        if (arg0 === 0)
            return 0.5;
        else if (arg0 === 1)
            return -0.5;
        else if (arg0 === 2)
            return -1.0;
        else
            return null;
    }

    protected calcGravityDir(dst: vec3): void {
        vec3.negate(dst, this.getNextPointNormal());
    }

    protected getTimeToNextPoint(sceneObjHolder: SceneObjHolder): number {
        return isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 15 : 30;
    }

    protected getGravityScalar(sceneObjHolder: SceneObjHolder): number {
        return isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 6.4 : 1.6;
    }

    protected abstract initFromRailPoint(sceneObjHolder: SceneObjHolder): void;
    protected abstract collectRailPointInfo(sceneObjHolder: SceneObjHolder): void;
    protected abstract incrementNextPoint(sceneObjHolder: SceneObjHolder): void;
    protected abstract startMoveInner(sceneObjHolder: SceneObjHolder): void;
    protected abstract updatePoseInner(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void;
    protected abstract getLastPointNormal(): vec3;
    protected abstract getNextPointNormal(): vec3;
    protected abstract getNextPointNo(): number;
}

const triangleScratch = new Triangle();
function getPolygonOnRailPoint(sceneObjHolder: SceneObjHolder, dstPos: vec3, dstNrm: vec3, actor: LiveActor, pointIdx: number): void {
    calcRailPointPos(dstPos, actor, pointIdx);
    calcGravityVector(sceneObjHolder, actor, dstPos, dstNrm);
    vec3.scale(dstNrm, dstNrm, 2000.0);
    if (getFirstPolyOnLineToMapExceptSensor(sceneObjHolder, dstPos, triangleScratch, dstPos, dstNrm, actor.getSensor('body')!))
        vec3.copy(dstNrm, triangleScratch.faceNormal);
    else
        vec3.normalize(dstNrm, dstNrm);
}

export class OnimasuJump extends Onimasu {
    private pointCount: number;
    private normals: vec3[];
    private nextPointNo: number = 0;

    protected initFromRailPoint(sceneObjHolder: SceneObjHolder): void {
        this.pointCount = getRailPointNum(this);
        this.normals = nArray(this.pointCount, () => vec3.create());
    }

    protected collectRailPointInfo(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.pointCount; i++)
            getPolygonOnRailPoint(sceneObjHolder, scratchVec3, this.normals[i], this, i);
    }

    protected incrementNextPoint(): void {
        this.nextPointNo++;
        if (this.nextPointNo >= getRailPointNum(this))
            this.nextPointNo = 0;
    }

    protected getLastPointNo(): number {
        let lastPointNo = this.nextPointNo - 1;
        if (lastPointNo < 0)
            lastPointNo += getRailPointNum(this);
        return lastPointNo;
    }

    protected getLastPointNormal(): vec3 {
        return this.normals[this.getLastPointNo()];
    }

    protected getNextPointNo(): number {
        return this.nextPointNo;
    }

    protected getNextPointNormal(): vec3 {
        return this.normals[this.nextPointNo];
    }

    protected updatePoseInner(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.calcGravityDir(scratchVec3);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3, deltaTimeFrames);
    }

    protected startMoveInner(sceneObjHolder: SceneObjHolder): void {
        calcRailPointPos(scratchVec3, this, this.nextPointNo);

        const distance = vec3.distance(scratchVec3, this.translation);
        const timeToNextPoint = this.getTimeToNextPoint(sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3, this.translation);
        normToLength(scratchVec3a, distance / timeToNextPoint);

        this.calcGravityDir(scratchVec3b);
        vec3.scale(scratchVec3b, scratchVec3b, -0.5 * timeToNextPoint);

        vec3.add(this.velocity, scratchVec3a, scratchVec3b);
    }
}

const enum RingBeamNrv { Spread }
class RingBeam extends LiveActor<RingBeamNrv> {
    private axisZ = vec3.create();
    private farPointPos = vec3.create();
    private farPointAxisY = vec3.create();
    private bloomModel: ModelObj;
    private speed: number = 20.0;
    private life: number = 100;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, private parentActor: LiveActor, private useFancyPosCalc: boolean, private useStaticShadow: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'RingBeam');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'JumpBeamerBeam');
        connectToSceneIndirectEnemy(sceneObjHolder, this);
        // initHitSensor
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(RingBeamNrv.Spread);
        this.initPos(this);
        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.axisZ, baseMtx);
        getMatrixTranslation(this.farPointPos, baseMtx);
        // shadow
        this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, 'JumpBeamerBeamBloom', 'JumpBeamerBeamBloom', this.getBaseMtx()!);
        this.makeActorDead(sceneObjHolder);
    }

    public setSpeed(speed: number): void {
        this.speed = speed;
    }

    public setLife(life: number): void {
        this.life = life;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamNrv, deltaTimeFrames: number): void {
        if (currentNerve === RingBeamNrv.Spread) {
            if (isFirstStep(this)) {
                startBckNoInterpole(this, 'Spread');
                startBckNoInterpole(this.bloomModel, 'Spread');

                startBrk(this, 'Erase');
                setBrkFrameAndStop(this, 0);

                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisZ(this.axisZ, baseMtx);
                getMatrixAxisY(scratchVec3, baseMtx);
                vec3.scaleAndAdd(this.farPointPos, this.parentActor.translation, scratchVec3, 75.0);
            }

            if (this.useFancyPosCalc) {
                vec3.scaleAndAdd(scratchVec3, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
                calcGravityVector(sceneObjHolder, this, scratchVec3, this.farPointAxisY);
                vec3.negate(this.farPointAxisY, this.farPointAxisY);
                makeMtxUpFront(scratchMatrix, this.farPointAxisY, this.axisZ);
                getMatrixAxisZ(this.axisZ, scratchMatrix);
                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisY(scratchVec3, baseMtx);
                vec3.scaleAndAdd(scratchVec3a, this.parentActor.translation, scratchVec3, 1.0);
                vec3.scaleAndAdd(scratchVec3b, this.parentActor.translation, scratchVec3, -1.0);
                calcPerpendicFootToLine(this.translation, this.farPointPos, scratchVec3a, scratchVec3b);
            }

            vec3.scaleAndAdd(this.farPointPos, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
            this.setRadius(vec3.distance(this.farPointPos, this.translation));

            // transSound

            if (isGreaterEqualStep(this, this.life - getBrkFrameMax(this))) {
                startBrk(this, 'Erase');
            }

            if (isGreaterEqualStep(this, this.life))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.bloomModel.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(RingBeamNrv.Spread);
        this.initPos(this.parentActor);
        this.setRadius(0);
        super.makeActorDead(sceneObjHolder);
        this.bloomModel.makeActorDead(sceneObjHolder);
    }

    private initPos(actor: LiveActor): void {
        const baseMtx = actor.getBaseMtx()!;
        getMatrixAxisY(scratchVec3, baseMtx);
        vec3.scaleAndAdd(this.translation, actor.translation, scratchVec3, 50.0);
    }

    private setRadius(radius: number): void {
        radius = Math.min(radius, 2000.0);
        startBckNoInterpole(this, 'Spread');
        startBckNoInterpole(this.bloomModel, 'Spread');
        const frame = (radius / 2000.0) * getBckFrameMax(this);
        setBckFrameAndStop(this, frame);
        setBckFrameAndStop(this.bloomModel, frame);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeam');
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeamBloom');
    }
}

const enum BallBeamerNrv { Wait, AttackChargeWait, AttackCharging, Inter }
export class BallBeamer extends LiveActor<BallBeamerNrv> {
    private switchOnA: boolean = false;
    private ringBeams: RingBeam[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'BallBeamer');

        this.initModelManagerWithAnm(sceneObjHolder, 'BallBeamer');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.translation[1] -= 50.0;
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        // addHitSensorPush
        // initShadowVolumeSphere
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(BallBeamerNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffA(sceneObjHolder, this, this.syncSwitchOnA.bind(this), this.syncSwitchOffA.bind(this));

        if (useStageSwitchWriteB(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffB(sceneObjHolder, this, this.syncSwitchOnB.bind(this), this.syncSwitchOffB.bind(this));

        const speed = fallback(getJMapInfoArg0(infoIter), 12.0);
        const life = fallback(getJMapInfoArg1(infoIter), 530);
        const useStaticShadow = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        for (let i = 0; i < 12; i++) {
            const ringBeam = new RingBeam(zoneAndLayer, sceneObjHolder, infoIter, this, true, useStaticShadow);
            ringBeam.setSpeed(speed);
            ringBeam.setLife(life);
            this.ringBeams.push(ringBeam);
        }
    }

    private attackCount: number = 0;
    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: BallBeamerNrv, deltaTimeFrames: number): void {
        if (currentNerve === BallBeamerNrv.Wait) {
            if (isFirstStep(this))
                startAction(this, 'Wait');

            if (isNearPlayer(sceneObjHolder, this, 3000.0))
                this.setupAttack(sceneObjHolder);
        } else if (currentNerve === BallBeamerNrv.AttackChargeWait) {
            // Original code charges on step 75, and fires on step 119, all mod 120, in the Attack state. We have
            // separate nerves for this.
            if (isGreaterEqualStep(this, 75)) {
                emitEffect(sceneObjHolder, this, 'Charge');
                this.setNerve(BallBeamerNrv.AttackCharging);
            }
        } else if (currentNerve === BallBeamerNrv.AttackCharging) {
            if (isGreaterEqualStep(this, (119 - 75))) {
                this.attackCount++;
                this.tryAttack(sceneObjHolder);
                startBck(this, 'Sign');
                if (this.attackCount === 3)
                    this.setNerve(BallBeamerNrv.Inter);
                else
                    this.setNerve(BallBeamerNrv.AttackChargeWait);
            }
        } else if (currentNerve === BallBeamerNrv.Inter) {
            if (isGreaterEqualStep(this, 120)) {
                if (this.switchOnA) {
                    this.attackCount = 0;
                    this.setNerve(BallBeamerNrv.AttackChargeWait);
                } else {
                    this.setNerve(BallBeamerNrv.Wait);
                }
            }
        }
    }

    private tryAttack(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.ringBeams.length; i++) {
            if (isDead(this.ringBeams[i])) {
                this.ringBeams[i].makeActorAppeared(sceneObjHolder);
                return;
            }
        }
    }

    private setupAttack(sceneObjHolder: SceneObjHolder): void {
        if (isValidSwitchA(this) && !isOnSwitchA(sceneObjHolder, this))
            return;

        const currentNerve = this.getCurrentNerve();
        if (currentNerve !== BallBeamerNrv.AttackChargeWait && currentNerve !== BallBeamerNrv.AttackCharging) {
            this.attackCount = 0;
            this.setNerve(BallBeamerNrv.AttackChargeWait);
        }
    }

    private syncSwitchOffA(sceneObjHolder: SceneObjHolder): void {
        this.switchOnA = false;
    }

    private syncSwitchOnA(sceneObjHolder: SceneObjHolder): void {
        this.switchOnA = true;
        this.setupAttack(sceneObjHolder);
    }

    private syncSwitchOffB(sceneObjHolder: SceneObjHolder): void {
    }

    private syncSwitchOnB(sceneObjHolder: SceneObjHolder): void {
        deleteEffect(sceneObjHolder, this, 'Charge');
        emitEffect(sceneObjHolder, this, 'Vanish');
        this.makeActorDead(sceneObjHolder);

        for (let i = 0; i < this.ringBeams.length; i++)
            this.ringBeams[i].makeActorDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        RingBeam.requestArchives(sceneObjHolder);
    }
}

function enableGroupAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, radius: number, threshold: number): boolean {
    if (isValidSwitchA(actor) && !actor.stageSwitchCtrl!.isOnSwitchA(sceneObjHolder))
        return false;
    if (isValidSwitchB(actor) && !actor.stageSwitchCtrl!.isOnSwitchB(sceneObjHolder))
        return false;

    const actorGroup = getGroupFromArray(sceneObjHolder, actor);
    if (actorGroup !== null)
        for (let i = 0; i < actorGroup.objArray.length; i++)
            if (calcSqDistanceToPlayer(sceneObjHolder, actorGroup.objArray[i]) < calcSqDistanceToPlayer(sceneObjHolder, actor))
                actor = actorGroup.objArray[i];

    return isNearPlayerPose(sceneObjHolder, actor, radius, threshold);
}

const enum RingBeamerNrv { Wait, Attack, Inter }
export class RingBeamer extends LiveActor<RingBeamerNrv> {
    private ringBeam: RingBeam[] = [];
    private currentAttackCount: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'RingBeamer');

        this.initModelManagerWithAnm(sceneObjHolder, 'RingBeamer');
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        // this.initHitSensor();
        // addHitSensorPush
        // addHitSensorMtxEnemyAttack
        initShadowVolumeSphere(sceneObjHolder, this, 120.0);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(RingBeamerNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        if (useStageSwitchWriteB(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffB(sceneObjHolder, this, this.syncSwitchOnB.bind(this), this.syncSwitchOffB.bind(this));
        joinToGroupArray(sceneObjHolder, this, infoIter, null, 0x20);

        const speed = fallback(getJMapInfoArg0(infoIter), 20.0);
        const life = fallback(getJMapInfoArg1(infoIter), 100);

        for (let i = 0; i < 3; i++) {
            const ringBeam = new RingBeam(zoneAndLayer, sceneObjHolder, infoIter, this, false, false);
            ringBeam.setSpeed(speed);
            ringBeam.setLife(life);
            this.ringBeam.push(ringBeam);
        }

        startBckWithInterpole(this, 'Open', 0);
        setBckFrameAndStop(this, 0);
        this.calcAnim(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RingBeamerNrv.Wait) {
            if (enableGroupAttack(sceneObjHolder, this, 3000.0, 500.0))
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncAttack, this, this.getSensor('body')!, 'body');
        } else if (currentNerve === RingBeamerNrv.Attack) {
            if (isFirstStep(this))
                startBck(this, 'Open');

            if (this.currentAttackCount >= 3) {
                this.setNerve(RingBeamerNrv.Inter);
            }

            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'Charge');

            if (isGreaterEqualStep(this, 79)) {
                deleteEffect(sceneObjHolder, this, 'Charge');
                if (enableGroupAttack(sceneObjHolder, this, 3200.0, 500.0)) {
                    const ringBeam = assertExists(this.ringBeam[this.currentAttackCount++]);
                    ringBeam.makeActorAppeared(sceneObjHolder);
                    this.setNerve(RingBeamerNrv.Attack);
                } else {
                    sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncInter, this, this.getSensor('body')!, 'body');
                }
            }
        } else if (currentNerve === RingBeamerNrv.Inter) {
            if (isGreaterEqualStep(this, 80)) {
                for (let i = 0; i < this.ringBeam.length; i++)
                    if (!isDead(this.ringBeam[i]))
                        return;

                this.setNerve(RingBeamerNrv.Wait);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.RingBeamer_SyncAttack) {
            this.currentAttackCount = 0;
            this.setNerve(RingBeamerNrv.Attack);
            return true;
        } else if (messageType === MessageType.RingBeamer_SyncInter) {
            this.setNerve(RingBeamerNrv.Inter);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    private syncSwitchOnB(sceneObjHolder: SceneObjHolder): void {
    }

    private syncSwitchOffB(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(RingBeamerNrv.Inter);
        for (let i = 0; i < this.ringBeam.length; i++)
            this.ringBeam[i].makeActorDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        RingBeam.requestArchives(sceneObjHolder);
    }
}

function trySetMoveLimitCollision(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    const collisionDirector = sceneObjHolder.collisionDirector;
    if (collisionDirector === null)
        return;

    vec3.scaleAndAdd(scratchVec3a, actor.translation, actor.gravityVector, -150.0);
    vec3.scaleAndAdd(scratchVec3b, actor.translation, actor.gravityVector, 1000.0);

    const moveLimitKeeper = collisionDirector.keepers[CollisionKeeperCategory.MoveLimit];
    const mapKeeper = collisionDirector.keepers[CollisionKeeperCategory.Map];
    if (moveLimitKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        actor.binder!.setExCollisionParts(moveLimitKeeper.strikeInfo[0].collisionParts!);
    } else if (mapKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        const mapCollisionParts = mapKeeper.strikeInfo[0].collisionParts!;
        const exParts = moveLimitKeeper.searchSameHostParts(mapCollisionParts);
        actor.binder!.setExCollisionParts(exParts);
    }
}

const enum UnizoNrv { Wait, Jump, Chase, CollidePlayer, CollideEnemy, Break, JumpDown, FireDown }
export class Unizo extends LiveActor<UnizoNrv> {
    private breakModel: ModelObj;
    private jumpHeight = 0.15;
    private wobbleY = 30.0;
    private size = 1.0;
    private baseMtx = mat4.create();
    private effectHostMtx = mat4.create();
    private rollRotation = quat.create();
    private blinkTime = 0;
    private isInAir = false;
    private chaseSinTimer = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        if (this.name === 'Unizo') {
            this.initModelManagerWithAnm(sceneObjHolder, 'Unizo');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoBreak`, `UnizoBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else if (this.name === 'UnizoLand') {
            this.jumpHeight = 0.8;
            this.wobbleY = 0.0;
            this.initModelManagerWithAnm(sceneObjHolder, 'UnizoLand');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoLandBreak`, `UnizoLandBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);

            initFur(sceneObjHolder, this);
        } else if (this.name === 'UnizoShoal') {
            this.initModelManagerWithAnm(sceneObjHolder, 'UnizoShoal');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoShoalBreak`, `UnizoShoalBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else {
            throw "whoops";
        }

        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(this.baseMtx, this);

        this.size = 1.0;
        vec3.set(this.scale, 1.0, 1.0, 1.0);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        vec3.set(scratchVec3, 0.0, 126.36 * this.size, 0.0);
        addHitSensor(sceneObjHolder, this, 'Body', HitSensorType.Unizo, 8, 115.2 * this.size, scratchVec3);
        // initStarPointerTarget
        this.initBinder(126.36 * this.size, 126.36 * this.size, 8);
        initShadowVolumeSphere(sceneObjHolder, this, 106.36 * this.size);
        initShadowVolumeSphere(sceneObjHolder, this.breakModel, 106.36 * this.size);
        this.initEffectKeeper(sceneObjHolder, null);

        if (this.name === 'UnizoShoal')
            setEffectHostMtx(this, 'Ripple', this.effectHostMtx);

        this.initNerve(UnizoNrv.Wait);
        this.calcGravityFlag = true;
        startBtp(this, 'Blink');
        this.blinkTime = getRandomInt(100, 200);
        // addToAttributeGroupSearchTurtle
        // declareStarPiece
        // AnimScaleController
        // WalkerStateBindStarPointer
        // setGroupClipping
        this.makeActorAppeared(sceneObjHolder);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    public getBaseMtx(): mat4 {
        return this.baseMtx;
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        mat4.fromQuat(scratchMatrix, this.rollRotation);
        getMatrixAxisY(scratchVec3a, scratchMatrix);
        vec3.scaleAndAdd(scratchVec3, this.translation, scratchVec3a, -126.36 * this.size);

        getMatrixAxisY(scratchVec3a, this.baseMtx);
        vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3a, 126.36 * this.size /* * this.animScaleController.scale[1] */);

        const wobbleY = this.size * Math.sin(this.chaseSinTimer) / 60 * this.wobbleY;

        vecKillElement(scratchVec3a, this.velocity, this.gravityVector);
        const gravityWobbleY = Math.min(vec3.length(scratchVec3) * 0.25, 1.0);

        vec3.scaleAndAdd(scratchVec3, scratchVec3, this.gravityVector, gravityWobbleY * wobbleY);
        setMatrixTranslation(scratchMatrix, scratchVec3);
        mat4.copy(this.modelInstance!.modelMatrix, scratchMatrix);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        validateShadowAll(this);
        validateShadowAll(this.breakModel);

        showModel(this);
        setMatrixTranslation(this.baseMtx, this.translation);
        super.makeActorAppeared(sceneObjHolder);

        quatFromEulerRadians(this.rollRotation, this.rotation[0], this.rotation[1], this.rotation[2]);
        quat.normalize(this.rollRotation, this.rollRotation);
        vec3.set(this.rotation, 0, 0, 0);

        this.isInAir = true;
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        validateHitSensors(this);
        this.breakModel.makeActorDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        this.chaseSinTimer += getDeltaTimeFrames(viewerInput);

        if (!isNearZeroVec3(this.velocity, 0.001))
            this.updateRotate();

        vec3.negate(scratchVec3, this.gravityVector);
        // turnMtxToYDir(this.baseMtx, scratchVec3, 1.0);
        setMatrixTranslation(this.baseMtx, this.translation);
        this.updateSurfaceEffect(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: UnizoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === UnizoNrv.Wait) {
            if (isFirstStep(this))
                startBtp(this, 'Normal');

            this.updateBlink();
            this.updateInfluence(sceneObjHolder);

            if (!this.isInAir && isBindedGround(this) && isNearPlayer(sceneObjHolder, this, 1500.0) /* && isPlayerDamaging() */) {
                this.doJump();
                this.setNerve(UnizoNrv.Jump);
            }
        } else if (currentNerve === UnizoNrv.Jump) {
            if (isFirstStep(this)) {
                startBck(this, 'Search');
                startBtp(this, 'Angry');
            }

            if (isGreaterEqualStep(this, 20))
                this.updateVelocity(sceneObjHolder);

            this.updateInfluence(sceneObjHolder);

            if (isBckStopped(this))
                this.setNerve(UnizoNrv.Chase);
        } else if (currentNerve === UnizoNrv.Chase) {
            this.updateVelocity(sceneObjHolder);
            this.updateInfluence(sceneObjHolder);

            if (this.name === 'UnizoLand')
                emitEffect(sceneObjHolder, this, 'SearchSmoke');

            if (!isNearPlayer(sceneObjHolder, this, 1500.0)) {
                deleteEffectAll(this);
                this.setNerve(UnizoNrv.Wait);
            }
        } else if (currentNerve === UnizoNrv.CollideEnemy) {
            if (isFirstStep(this)) {
                if (isBtpStopped(this)) {
                }
            }

            this.updateInfluence(sceneObjHolder);

            if (isGreaterStep(this, 60)) {
                startBtp(this, 'Angry');
                this.setNerve(UnizoNrv.Chase);
            }
        } else if (currentNerve === UnizoNrv.JumpDown) {
            addVelocityToGravity(this, 1.1);
            this.updateRotate();
            this.calcAndSetBaseMtx(sceneObjHolder);
            vec3.copy(this.breakModel.translation, this.translation);

            if (isDead(this.breakModel) || (isBckStopped(this.breakModel) && isBrkStopped(this.breakModel)))
                this.makeActorDead(sceneObjHolder);

            if (isGreaterEqualStep(this, 50))
                this.makeActorDead(sceneObjHolder);
        }
    }

    private isBreakNow(): boolean {
        return this.getCurrentNerve() === UnizoNrv.Break || this.getCurrentNerve() === UnizoNrv.FireDown || this.getCurrentNerve() === UnizoNrv.JumpDown;
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (this.isBreakNow())
            return;

        if (isSensorPlayerOrRide(otherSensor)) {
            // TODO(jstpierre)
        } else if (isSensorEnemy(otherSensor)) {
            if (sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor) && this.getCurrentNerve() !== UnizoNrv.CollideEnemy) {
                this.setNerve(UnizoNrv.CollideEnemy);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.EnemyAttack) {
            if (otherSensor!.isType(HitSensorType.Unizo)) {
                vec3.sub(scratchVec3, thisSensor!.center, otherSensor!.center);
                const dist = vec3.length(scratchVec3);
                vec3.normalize(scratchVec3, scratchVec3);
                addVelocityMoveToDirection(this, scratchVec3, dist * 0.2);
                if (!isBckPlaying(this, 'Shock'))
                    startBck(this, 'Shock');
            } else {
                this.doBreak();
            }

            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private doJump(): void {
        this.isInAir = true;

        const jumpHeight = Math.sqrt(2.0 * this.size * (70.0 * this.jumpHeight * vec3.length(this.gravityVector)));
        vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -jumpHeight);
    }

    private doBreak(): void {
    }

    private appearBreakModel(sceneObjHolder: SceneObjHolder): void {
        vec3.copy(this.breakModel.translation, this.translation);
        vec3.copy(this.breakModel.scale, this.scale);
        getCamYdir(scratchVec3a, sceneObjHolder.viewerInput.camera);
        getCamZdir(scratchVec3b, sceneObjHolder.viewerInput.camera);
        vec3.negate(scratchVec3b, scratchVec3b);
        makeMtxFrontUp(scratchMatrix, scratchVec3b, scratchVec3a);
        computeEulerAngleRotationFromSRTMatrix(this.breakModel.rotation, scratchMatrix);
        this.breakModel.makeActorAppeared(sceneObjHolder);

        hideModel(this);
        invalidateHitSensors(this);
        invalidateShadowAll(this);
        invalidateShadowAll(this.breakModel);
    }

    private doJumpDown(sceneObjHolder: SceneObjHolder): void {
        this.appearBreakModel(sceneObjHolder);

        if (this.name === 'UnizoShoal') {
            startBck(this.breakModel, 'Firedown');
            startBrk(this.breakModel, 'Break');
        } else if (this.name === 'UnizoLand') {
            startBck(this.breakModel, 'Firedown');
            startBrk(this.breakModel, 'FireDown');
        }

        vec3.scale(this.velocity, this.gravityVector, -30.0);
        this.setNerve(UnizoNrv.JumpDown);
    }

    private updateBlink(): void {
        if (this.getNerveStep() % 200 === this.blinkTime)
            startBtp(this, 'Blink');
    }

    private updateVelocity(sceneObjHolder: SceneObjHolder): void {
        getPlayerPos(scratchVec3, sceneObjHolder);
        vec3.sub(scratchVec3, scratchVec3, this.translation);
        vecKillElement(scratchVec3, scratchVec3, this.gravityVector);
        vec3.normalize(scratchVec3, scratchVec3);
        
        vec3.normalize(scratchVec3a, this.gravityVector);
        const chaseSin = Math.sin(this.chaseSinTimer / 20.0);
        const chaseSpeed = 0.25 * MathConstants.TAU * chaseSin * Math.min(vec3.length(this.velocity) * 0.25, 1.0);
        mat4.fromRotation(scratchMatrix, chaseSpeed, scratchVec3a);

        transformVec3Mat4w0(scratchVec3, scratchMatrix, scratchVec3);
        if (vec3.dot(scratchVec3, this.velocity) <= 0.0) {
            addVelocityMoveToDirection(this, scratchVec3, 0.1);
        } else if (vec3.squaredLength(this.velocity) < 4.0**2) {
            addVelocityMoveToDirection(this, scratchVec3, 0.1);
        }
    }

    private updateInfluence(sceneObjHolder: SceneObjHolder): void {
        let didRebound = false;
        if (!this.isInAir) {
            didRebound = reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);

            if (isBindedGround(this))
                addVelocityToGravity(this, 0.2);
            else
                addVelocityToGravity(this, 0.8);
        } else {
            addVelocityToGravity(this, this.jumpHeight);
            didRebound = reboundVelocityFromCollision(this, 0.6, 0.0, 1.0);
        }

        restrictVelocity(this, 12.0);

        if (this.isBreakGround(sceneObjHolder)) {
            this.doJumpDown(sceneObjHolder);
        } else {
            // play sounds

            if (isBindedGround(this)) {
                if (this.getCurrentNerve() !== UnizoNrv.CollidePlayer && this.getCurrentNerve() !== UnizoNrv.Wait) {
                    attenuateVelocity(this, 0.96);
                } else {
                    attenuateVelocity(this, 0.9);

                    if (vec3.length(this.velocity) < 0.5)
                        vec3.zero(this.velocity);
                }

                this.isInAir = false;
            }
        }
    }

    private isBreakGround(sceneObjHolder: SceneObjHolder): boolean {
        for (let i = 0; i < this.binder!.hitInfoCount; i++) {
            const hitInfo = this.binder!.hitInfos[i];
            if (isGroundCodeDamage(sceneObjHolder, hitInfo) || isGroundCodeDamageFire(sceneObjHolder, hitInfo))
                return true;
        }

        return false;
    }

    private updateRotate(): void {
        vec3.negate(scratchVec3, this.gravityVector);
        rotateQuatRollBall(this.rollRotation, this.velocity, scratchVec3, 126.26 * this.size);
    }

    private updateSurfaceEffect(sceneObjHolder: SceneObjHolder): void {
        // spawn water ripples
        if (this.name !== 'UnizoShoal')
            return;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData(`${getObjectName(infoIter)}Break`);
    }
}

class TerritoryMover {
    private center = vec3.create();
    public targetPos = vec3.create();

    constructor(private radius: number) {
    }

    public setCenter(v: ReadonlyVec3): void {
        vec3.copy(this.center, v);
    }

    public decideNextTargetPos(actor: LiveActor): void {
        getRandomVector(scratchVec3, 1.0);
        vec3.normalize(scratchVec3, scratchVec3);

        vecKillElement(scratchVec3, scratchVec3, actor.gravityVector);
        vec3.scaleAndAdd(this.targetPos, this.center, scratchVec3, this.radius);
    }

    public isReachedTarget(actor: LiveActor, dist: number): boolean {
        vec3.sub(scratchVec3, actor.translation, this.targetPos);
        vecKillElement(scratchVec3, scratchVec3, actor.gravityVector);
        return vec3.squaredLength(scratchVec3) < dist**2.0;
    }
}

abstract class ActorStateBaseInterface<T extends number = number> extends NerveExecutor<T> {
    public isDead: boolean = false;

    public appear(): void {
        this.isDead = false;
    }

    public kill(): void {
        this.isDead = true;
    }

    public control(): void {
    }

    public update(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.updateNerveExecutor(sceneObjHolder, deltaTimeFrames);

        if (!this.isDead)
            this.control();

        return this.isDead;
    }
}

interface WalkerStateParam {
    gravitySpeed: number;
    velDragAir: number;
    velDragGround: number;
}

interface WalkerStateWanderParam {
    turnSpeedDegrees: number;
    waitStep: number;
    walkSpeed: number;
    walkStep: number;
    targetRadius: number;
}

function calcPassiveMovement(actor: LiveActor, param: Readonly<WalkerStateParam>, deltaTimeFrames: number): void {
    reboundVelocityFromEachCollision(actor, -1.0, -1.0, 0.0, 0.0);
    if (isOnGround(actor)) {
        attenuateVelocity(actor, param.velDragGround ** deltaTimeFrames);
    } else {
        addVelocityToGravity(actor, param.gravitySpeed * deltaTimeFrames);
        attenuateVelocity(actor, param.velDragAir ** deltaTimeFrames);
    }
}

function turnDirectionToTargetUseGroundNormalDegree(actor: LiveActor, dst: vec3, targetPos: ReadonlyVec3, speedInDegrees: number): boolean {
    vec3.sub(scratchVec3, targetPos, actor.translation);
    const speed = Math.cos(MathConstants.DEG_TO_RAD * speedInDegrees);
    const plane = isBindedGround(actor) ? (actor.binder!.floorHitInfo.faceNormal) : actor.gravityVector;
    return turnVecToVecCosOnPlane(dst, dst, scratchVec3, plane, speed);
}

function isNearAngleVec3(a: ReadonlyVec3, b: ReadonlyVec3, cutoff: number): boolean {
    if (isNearZeroVec3(a, 0.001) || isNearZeroVec3(b, 0.001))
        return false;

    const magA = vec3.length(a), magB = vec3.length(b);
    return (vec3.dot(a, b) / (magA * magB)) >= cutoff;
}

function isFaceToTargetHorizontalDegree(actor: LiveActor, target: ReadonlyVec3, direction: ReadonlyVec3, degrees: number): boolean {
    vec3.sub(scratchVec3a, target, actor.translation);
    vec3.normalize(scratchVec3a, scratchVec3a);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    vecKillElement(scratchVec3b, direction, actor.gravityVector);
    return isNearAngleVec3(scratchVec3a, scratchVec3b, Math.cos(MathConstants.DEG_TO_RAD * degrees));
}

function isFallNextMoveActor(actor: Readonly<LiveActor>, a: number, b: number, c: number, filter: TriangleFilterFunc | null = null): boolean {
    // TODO(jstpierre)
    return false;
}

enum WalkerStateWanderNrv { Wait, Walk }
class WalkerStateWander extends ActorStateBaseInterface<WalkerStateWanderNrv> {
    private territoryMover = new TerritoryMover(500.0);

    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramWander: WalkerStateWanderParam) {
        super();

        this.initNerve(WalkerStateWanderNrv.Wait);
        this.territoryMover.setCenter(this.actor.translation);
    }

    public setWanderCenter(v: ReadonlyVec3): void {
        this.territoryMover.setCenter(v);
    }

    public appear(): void {
        this.isDead = false;
        this.setNerve(WalkerStateWanderNrv.Wait);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateWanderNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateWanderNrv.Wait) {
            if (isFirstStep(this))
                startAction(this.actor, 'Wait');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isGreaterStep(this, this.paramWander.waitStep)) {
                this.territoryMover.decideNextTargetPos(this.actor);
                this.setNerve(WalkerStateWanderNrv.Walk);
            }
        } else if (currentNerve === WalkerStateWanderNrv.Walk) {
            if (isFirstStep(this))
                startAction(this.actor, 'Walk');

            turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, this.territoryMover.targetPos, this.paramWander.turnSpeedDegrees);
            if (isFaceToTargetHorizontalDegree(this.actor, this.territoryMover.targetPos, this.front, 8.0))
                addVelocityMoveToDirection(this.actor, this.front, this.paramWander.walkSpeed);

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (!isFallNextMoveActor(this.actor, 150.0, 150.0, 150.0)) {
                if (this.territoryMover.isReachedTarget(this.actor, this.paramWander.targetRadius) || isGreaterStep(this, this.paramWander.walkStep)) {
                    this.setNerve(WalkerStateWanderNrv.Wait);
                }
            } else {
                vec3.zero(this.actor.velocity);
                this.setNerve(WalkerStateWanderNrv.Wait);
            }
        }
    }
}

function updateActorState(sceneObjHolder: SceneObjHolder, actor: LiveActor, state: ActorStateBaseInterface, deltaTimeFrames: number): void {
    if (isFirstStep(actor))
        state.appear();

    const isDead = state.update(sceneObjHolder, deltaTimeFrames);
    if (isDead)
        state.kill();
}

function makeQuatAndFrontFromRotate(dstQuat: quat, dstFront: vec3, actor: Readonly<LiveActor>): void {
    quatFromEulerRadians(dstQuat, actor.rotation[0], actor.rotation[1], actor.rotation[2]);
    quatGetAxisZ(dstFront, dstQuat);
}

function blendQuatFromGroundAndFront(dst: quat, actor: Readonly<LiveActor>, front: ReadonlyVec3, speedUp: number, speedFront: number): void {
    if (isBindedGround(actor)) {
        vec3.copy(scratchVec3, actor.binder!.floorHitInfo.faceNormal);
    } else {
        vec3.negate(scratchVec3, actor.gravityVector);
    }

    blendQuatUpFront(dst, dst, scratchVec3, front, speedUp, speedFront);
}

function turnQuatUpToGravity(dst: quat, src: ReadonlyQuat, actor: Readonly<LiveActor>): void {
    quatGetAxisY(scratchVec3a, src);
    vec3.negate(scratchVec3b, actor.gravityVector);

    if (vec3.dot(scratchVec3a, scratchVec3b) > -0.999) {
        quatSetRotate(scratchQuat, scratchVec3a, scratchVec3b);
    } else {
        quatGetAxisX(scratchVec3a, src);
        quat.setAxisAngle(scratchQuat, scratchVec3a, MathConstants.TAU / 4);
    }
    quat.mul(dst, scratchQuat, src);
    quat.normalize(dst, dst);
}

const enum KuriboNrv { Wander }
export class Kuribo extends LiveActor<KuriboNrv> {
    private quat = quat.create();
    private front = vec3.create();
    private manualGravity: boolean = false;
    private stateWander: WalkerStateWander;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kuribo');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        makeQuatAndFrontFromRotate(this.quat, this.front, this);

        if (infoIter !== null)
            this.manualGravity = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        if (this.manualGravity) {
            this.calcGravityFlag = false;
            quatGetAxisY(this.gravityVector, this.quat);
        } else {
            this.calcGravityFlag = true;
        }

        const radius = 70.0 * this.scale[1];
        this.initBinder(radius, radius, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        this.initState();
        this.initNerve(KuriboNrv.Wander);

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        turnQuatUpToGravity(this.quat, this.quat, this);
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    protected calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.quat, this.translation);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (this.manualGravity)
            calcGravity(sceneObjHolder, this);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        blendQuatFromGroundAndFront(this.quat, this, this.front, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);

        // this.binder!.debugDrawAllFloorHitInfo(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix);

        // calcVelocityAreaOrRailMoveOnGround
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KuriboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KuriboNrv.Wander) {
            updateActorState(sceneObjHolder, this, this.stateWander, deltaTimeFrames);

            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.translation, this.front, 100.0);
            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.translation, this.velocity, 1.0, Green);

            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.stateWander.territoryMover.targetPos, Green, 10);
        }
    }

    private initState(): void {
        const param: WalkerStateParam = {
            gravitySpeed: 1.5,
            velDragAir: 0.99,
            velDragGround: 0.93,
        };

        const paramWander: WalkerStateWanderParam = {
            walkSpeed: 0.2,
            waitStep: 120,
            walkStep: 120,
            turnSpeedDegrees: 3.0,
            targetRadius: 20.0,
        };

        this.stateWander = new WalkerStateWander(this, this.front, param, paramWander);
    }
}

function createPartsModelEnemyAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, transformMtx: ReadonlyMat4 | null, localTrans: vec3 | null, localRot: vec3 | null, jointName: string | null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.MapObj, transformMtx);
    model.initFixedPositionJoint(jointName, localTrans, localRot);
    return model;
}

const enum HomingKillerNrv { Appear, MoveStart, Move, ChaseStart, Chase, GoToTarget, Break }
const enum HomingKillerType { HomingKiller, Torpedo, MagnumKiller }
class HomingKiller extends LiveActor<HomingKillerNrv> {
    private type: HomingKillerType;
    private baseMtx = mat4.create();
    private effectHostMtx = mat4.create();
    private origTranslation = vec3.create();
    private origAxisY = vec3.create();
    private origAxisZ = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();

    private torpedoPropellerParts: PartsModel | null = null;
    private torpedoLightParts: ModelObj | null = null;
    private moveTimer = 0;
    private chaseTimer = 0;

    private chaseStartDistance: number;
    private chaseEndDistance: number;
    private turnSpeed = 0.9997;
    private nonHoming = false;
    private chaseAllAround = false;
    private chaseValidAngle = MathConstants.TAU;
    private upright = false;
    private targetSensor: HitSensor | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        if (this.name === 'HomingKiller')
            this.type = HomingKillerType.HomingKiller;
        else if (this.name === 'Torpedo')
            this.type = HomingKillerType.Torpedo;
        else if (this.name === 'MagnumKiller')
            this.type = HomingKillerType.MagnumKiller;
        else
            throw "whoops";

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.chaseStartDistance = fallback(getJMapInfoArg0(infoIter), 2000.0);
        // noclip modification: severely up the chase end distance because the player has camera speed controls
        this.chaseEndDistance = 50000.0;
        const turnSpeedParam = fallback(getJMapInfoArg1(infoIter), 3);
        this.turnSpeed = 1.0 - (0.0001 * turnSpeedParam);
        this.nonHoming = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1)) || this.type === HomingKillerType.MagnumKiller;
        this.chaseAllAround = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        this.upright = this.nonHoming || this.chaseAllAround;

        if (!this.chaseAllAround)
            this.chaseValidAngle = MathConstants.TAU / 2;

        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        if (this.type === HomingKillerType.Torpedo) {
            this.torpedoPropellerParts = createPartsModelEnemyAndFix(sceneObjHolder, this, 'TorpedoPropeller', null, null, null, null);
            this.torpedoLightParts = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'TorpedoLight', 'TorpedoLight', this.getBaseMtx()!);
            this.torpedoLightParts.makeActorDead(sceneObjHolder);
        }

        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);

        this.initHitSensor();

        const scale = this.type === HomingKillerType.MagnumKiller ? 4.0 : 1.0;

        vec3.set(scratchVec3a, 0.0, 0.0, -10.0);
        vec3.scale(scratchVec3a, scratchVec3a, scale);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.HomingKiller, 8, 70.0 * scale, scratchVec3a);
        addHitSensorEye(sceneObjHolder, this, 'eye', 16, 750.0, Vec3Zero);
        this.initBinder(70.0 * scale, 0.0, 0);
        this.calcGravityFlag = true;
        calcGravity(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
        if (this.type === HomingKillerType.HomingKiller)
            setEffectHostMtx(this, 'SandColumn', this.effectHostMtx);

        // initStarPointerTarget

        // calcInitPosture()
        vec3.copy(this.origTranslation, this.translation);
        computeModelMatrixR(scratchMatrix, this.rotation[0], this.rotation[1], this.rotation[2]);
        getMatrixAxisZ(this.origAxisZ, scratchMatrix);
        if (!this.upright) {
            vecKillElement(this.origAxisZ, this.origAxisZ, this.gravityVector);
            vec3.normalize(this.origAxisZ, this.origAxisZ);
        }

        if (this.upright) {
            getMatrixAxisY(this.origAxisY, scratchMatrix);
        } else {
            vec3.negate(this.origAxisY, this.gravityVector);
        }

        // initSound

        if (this.type === HomingKillerType.MagnumKiller) {
            initShadowFromCSV(sceneObjHolder, this);
        } else {
            vec3.set(scratchVec3a, 60.0, 60.0, 100.0);
            vec3.scale(scratchVec3a, scratchVec3a, scale);
            initShadowVolumeOval(sceneObjHolder, this, scratchVec3a);
            setShadowDropLength(this, null, 2000.0);
        }

        // addToAttributeGroupSearchTurtle
        // invalidateClipping
        this.initNerve(HomingKillerNrv.Appear);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        vec3.copy(this.translation, this.origTranslation);
        vec3.zero(this.rotation);
        vec3.copy(this.axisZ, this.origAxisZ);
        vec3.copy(this.axisY, this.origAxisY);
        this.moveTimer = 0;
        this.chaseTimer = 0;
        this.updateBaseMtxNoRotateZ();
        showModel(this);
        this.calcBinderFlag = false;
        validateHitSensors(this);
        invalidateShadowAll(this);

        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(HomingKillerNrv.Appear);
    }

    public calcAndSetBaseMtx(): void {
        mat4.rotateZ(this.modelInstance!.modelMatrix, this.baseMtx, this.rotation[2] * 0.02);
    }

    private setBckRate(rate: number, includeParts: boolean): void {
        if (this.type === HomingKillerType.MagnumKiller)
            return;

        setBckRate(this, rate);

        if (includeParts && this.type === HomingKillerType.Torpedo)
            setBckRate(this.torpedoPropellerParts!, rate);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HomingKillerNrv.Appear) {
            if (isFirstStep(this)) {
                startBck(this, 'Start');

                if (this.type !== HomingKillerType.MagnumKiller) {
                    startBpk(this, 'Move');
                    startBrk(this, 'Move');
                }

                if (this.type === HomingKillerType.Torpedo) {
                    startBck(this.torpedoPropellerParts!, 'RotateTorpedo');
                    this.torpedoLightParts!.makeActorAppeared(sceneObjHolder);
                    startBck(this.torpedoLightParts!, 'Appear');
                }

                this.setBckRate(0.0, true);
            }

            let translateZ = saturate(this.getNerveStep() / 20.0) * 200.0;

            if (isGreaterStep(this, 20) && isLessStep(this, 42)) {
                const appearSignStep = (this.getNerveStep() - 20);
                const appearSignZ = Math.sin(appearSignStep * 100.0 * MathConstants.DEG_TO_RAD);
                translateZ += (appearSignStep * 18.0 * appearSignZ) / 22.0;
            }

            vec3.scaleAndAdd(this.translation, this.origTranslation, this.origAxisZ, translateZ);

            if (isGreaterEqualStep(this, 72)) {
                this.setBckRate(1.0, true);
                emitEffect(sceneObjHolder, this, 'Shoot');
                validateShadowAll(this);

                if (this.type === HomingKillerType.HomingKiller)
                    this.setNerve(HomingKillerNrv.MoveStart);
                else
                    this.setNerve(HomingKillerNrv.Move);
            }
        } else if (currentNerve === HomingKillerNrv.MoveStart) {
            if (!this.processMove(sceneObjHolder, deltaTimeFrames))
                return;
            if (!this.tryChaseStart(sceneObjHolder, deltaTimeFrames))
                return;
            if (isBckStopped(this))
                this.setNerve(HomingKillerNrv.Move);
        } else if (currentNerve === HomingKillerNrv.Move) {
            if (isFirstStep(this))
                tryStartBck(this, 'Move');
            if (!this.processMove(sceneObjHolder, deltaTimeFrames))
                return;
            this.tryChaseStart(sceneObjHolder, deltaTimeFrames);
        } else if (currentNerve === HomingKillerNrv.ChaseStart) {
            if (isFirstStep(this)) {
                if (tryStartBck(this, 'ChaseStart')) {
                    startBpk(this, 'Chase');
                    startBrk(this, 'Chase');
                }
            }
            if (!this.processChase(sceneObjHolder, deltaTimeFrames))
                return;
            if (isBckStopped(this))
                this.setNerve(HomingKillerNrv.Chase);
        } else if (currentNerve === HomingKillerNrv.Chase) {
            if (isFirstStep(this))
                tryStartBck(this, 'Chase');
            this.processChase(sceneObjHolder, deltaTimeFrames);
        } else if (currentNerve === HomingKillerNrv.GoToTarget) {
            if (this.processChase(sceneObjHolder, deltaTimeFrames)) {
                const eyeSensor = this.getSensor('eye')!;
                let eyeHasTarget = false;
                for (let i = 0; i < eyeSensor.pairwiseSensors.length; i++) {
                    if (eyeSensor.pairwiseSensors[i] === this.targetSensor) {
                        eyeHasTarget = true;
                        break;
                    }
                }

                if (!eyeHasTarget)
                    this.setNerve(HomingKillerNrv.Chase);
            }
        } else if (currentNerve === HomingKillerNrv.Break) {
            if (isFirstStep(this)) {
                this.sendMsgExplosionToNearActor(sceneObjHolder);
                hideModel(this);
                invalidateHitSensors(this);
                this.calcBinderFlag = false;
                vec3.zero(this.velocity);
                deleteEffectAll(this);
                if (this.torpedoLightParts !== null)
                    this.torpedoLightParts.makeActorDead(sceneObjHolder);
                emitEffect(sceneObjHolder, this, 'Explosion');
                if (isBindedGround(this)) {
                    calcGravity(sceneObjHolder, this);
                    if (this.type === HomingKillerType.HomingKiller) {
                        const groundSensor = this.binder!.floorHitInfo.hitSensor!;
                        if (!groundSensor.isType(HitSensorType.BreakableCage)) {
                            const groundNormal = this.binder!.floorHitInfo.faceNormal;
                            if (vec3.dot(this.gravityVector, groundNormal) < -0.75) {
                                emitEffect(sceneObjHolder, this, 'SandColumn');

                                let effectPos: ReadonlyVec3;
                                if (isShadowProjected(this, null))
                                    effectPos = getShadowProjectionPos(this, null);
                                else
                                    effectPos = this.translation;

                                vec3.negate(scratchVec3, this.gravityVector);
                                if (isSameDirection(this.axisZ, scratchVec3, 0.01))
                                    makeMtxUpNoSupportPos(this.effectHostMtx, scratchVec3, effectPos);
                                else
                                    makeMtxUpFrontPos(this.effectHostMtx, scratchVec3a, this.axisZ, effectPos);
                            }
                        }
                    }
                }
            }

            if (!isEffectValid(this, 'Explosion') && !(this.type === HomingKillerType.HomingKiller && isEffectValid(this, 'SandColumn'))) {
                this.makeActorDead(sceneObjHolder);
            }
        }
    }

    private isChasing(): boolean {
        return (this.isNerve(HomingKillerNrv.ChaseStart) || this.isNerve(HomingKillerNrv.Chase));
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const isChasing = this.isChasing();

        if (!this.isNerve(HomingKillerNrv.Appear) && !this.isNerve(HomingKillerNrv.Break)) {
            if (this.type === HomingKillerType.Torpedo)
                emitEffect(sceneObjHolder, this, isChasing ? 'BubbleChase' : 'Bubble');
            else
                emitEffect(sceneObjHolder, this, isChasing ? 'SmokeChase' : 'Smoke');
        }

        if (!this.isNerve(HomingKillerNrv.Break)) {
            if (!this.upright || isChasing) {
                vec3.negate(scratchVec3a, this.gravityVector);
                if (isChasing) {
                    turnVecToVecCos(this.axisY, this.axisY, scratchVec3a, Math.cos(2.0 * MathConstants.DEG_TO_RAD), this.axisZ, 0.02);
                } else {
                    vec3.copy(this.axisY, scratchVec3a);
                }
            }

            this.updateBaseMtxNoRotateZ();
        }
    }

    private static sensorTableTarget: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.BreakableCage,
        HitSensorType.Rock,
        HitSensorType.Wanwan,
        HitSensorType.PunchBox,
    ];

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (this.isNerve(HomingKillerNrv.Appear) || this.isNerve(HomingKillerNrv.Break))
            return;

        const eyeSensor = this.getSensor('eye');
        if (thisSensor === eyeSensor) {
            if (this.isNerve(HomingKillerNrv.Chase) && HomingKiller.isSensorType(otherSensor, HomingKiller.sensorTableTarget)) {
                this.targetSensor = otherSensor;
                this.setNerve(HomingKillerNrv.GoToTarget);
            }
        } else {
            if (isSensorPlayerOrRide(otherSensor)) {
                if (sendMsgEnemyAttackExplosion(sceneObjHolder, otherSensor, thisSensor))
                    this.setNerve(HomingKillerNrv.Break);
            } else {
                if (!otherSensor.isType(HitSensorType.Karikari)) {
                    const didExplode = this.tryToExplosion(sceneObjHolder, thisSensor, otherSensor);
                    if (didExplode && this.type !== HomingKillerType.MagnumKiller)
                        this.setNerve(HomingKillerNrv.Break);
                }
            }
        }
    }

    private updateVelocity(): void {
        // noclip modification: Increase Torpedo speed by 3x to make it faster to hit the weight in Buoy Base.
        const speed = this.type === HomingKillerType.Torpedo ? (3.0 * 5.0) : 12.0;
        vec3.scale(this.velocity, this.axisZ, speed);
    }

    private processMove(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.moveTimer += deltaTimeFrames;

        if (this.tryBindedBreak(sceneObjHolder) || this.moveTimer >= 608 || this.isWaterBreak(sceneObjHolder)) {
            this.setNerve(HomingKillerNrv.Break);
            return false;
        }

        if (!this.upright) {
            if (isSameDirection(this.axisZ, this.gravityVector, 0.01)) {
                vec3.copy(scratchVec3b, this.axisZ);
            } else {
                vecKillElement(scratchVec3b, this.axisZ, this.gravityVector);
                vec3.normalize(scratchVec3b, scratchVec3b);
            }

            turnVecToVecCos(this.axisZ, this.axisZ, scratchVec3b, 0.9995, this.gravityVector, 0.02);
        }

        this.updateVelocity();
        return true;
    }

    private isWaterBreak(sceneObjHolder: SceneObjHolder): boolean {
        const inWater = isInWater(sceneObjHolder, this.translation);

        if (this.type === HomingKillerType.Torpedo)
            return !inWater;
        else
            return inWater;
    }

    private isChaseStart(sceneObjHolder: SceneObjHolder): boolean {
        if (this.chaseTimer < 35)
            return false;

        if (isHiddenModel(this))
            return false;

        if (!isNearPlayer(sceneObjHolder, this, this.chaseStartDistance))
            return false;

        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);
        if (vec3.dot(this.axisZ, scratchVec3a) < Math.cos(this.chaseValidAngle))
            return false;

        return true;
    }

    private tryChaseStart(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.chaseTimer += deltaTimeFrames;

        if (this.chaseTimer >= 35)
            this.calcBinderFlag = true;

        if (!this.nonHoming && this.isChaseStart(sceneObjHolder)) {
            const effectName = this.type === HomingKillerType.Torpedo ? 'Bubble' : 'Smoke';
            deleteEffect(sceneObjHolder, this, effectName);
            this.setNerve(HomingKillerNrv.ChaseStart);
            return true;
        }

        return false;
    }

    private calcFrontVecToTarget(dst: vec3, sceneObjHolder: SceneObjHolder): void {
        // getPlayerUpVec
        getMatrixAxisY(scratchVec3a, sceneObjHolder.viewerInput.camera.worldMatrix);
        const scale = this.type === HomingKillerType.Torpedo ? 75.0 : 200.0;
        getPlayerPos(scratchVec3b, sceneObjHolder);
        normToLengthAndAdd(scratchVec3b, scratchVec3a, scale);
        vec3.sub(dst, scratchVec3b, this.translation);
        vec3.normalize(dst, dst);
    }

    private isUpdateChaseFrontVec(v: ReadonlyVec3): boolean {
        if (!this.isNerve(HomingKillerNrv.GoToTarget))
            return true;

        vec3.sub(scratchVec3b, this.targetSensor!.center, this.translation);
        vec3.normalize(scratchVec3b, scratchVec3b);
        return vec3.dot(scratchVec3b, v) > vec3.dot(scratchVec3b, this.axisZ);
    }

    private updateRotateZ(chaseVec: ReadonlyVec3, deltaTimeFrames: number): void {
        const rotateSpeed = 1.0 * MathConstants.DEG_TO_RAD * deltaTimeFrames;

        if (!isSameDirection(this.axisZ, this.gravityVector, 0.01) && !isSameDirection(chaseVec, this.gravityVector, 0.01)) {
            vecKillElement(scratchVec3a, chaseVec, this.gravityVector);
            vecKillElement(scratchVec3b, this.axisZ, this.gravityVector);

            // Twist towards our target.
            if (vec3.dot(scratchVec3a, scratchVec3b) < 0.95) {
                vec3.cross(scratchVec3b, scratchVec3a, scratchVec3c);
                const speed = rotateSpeed * Math.sign(vec3.dot(scratchVec3c, this.gravityVector));
                this.rotation[2] = clamp(this.rotation[2] + speed, -60.0 * MathConstants.DEG_TO_RAD, 60.0 * MathConstants.DEG_TO_RAD);
                return;
            }
        }

        // Try to twist back to normal.
        if (this.rotation[2] > 0.0)
            this.rotation[2] = Math.max(this.rotation[2] - rotateSpeed, 0.0);
        if (this.rotation[2] < 0.0)
            this.rotation[2] = Math.min(this.rotation[2] + rotateSpeed, 0.0);
    }

    private processChase(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.moveTimer += deltaTimeFrames;

        if (this.tryBindedBreak(sceneObjHolder) || this.isWaterBreak(sceneObjHolder) || !isNearPlayer(sceneObjHolder, this, this.chaseEndDistance) ||
            // noclip modification: we don't have a hitsensor for the player (camera)
            isNearPlayer(sceneObjHolder, this, 100.0)
        ) {
            this.setNerve(HomingKillerNrv.Break);
            return false;
        }

        this.calcFrontVecToTarget(scratchVec3a, sceneObjHolder);

        if (isShadowProjected(this, null)) {
            const shadowPos = getShadowProjectionPos(this, null);
            const shadowSensor = getShadowProjectedSensor(this, null);
            if (shadowSensor.isType(HitSensorType.BreakableCage)) {
                if (vec3.squaredDistance(this.translation, shadowPos) < 300.0**2) {
                    vec3.sub(scratchVec3a, shadowSensor.center, this.translation);
                    vec3.normalize(scratchVec3a, scratchVec3a);
                }
            } else {
                if (vec3.squaredDistance(this.translation, shadowPos) < 150.0**2) {
                    getMatrixAxisY(scratchVec3b, this.baseMtx);
                    if (!isSameDirection(scratchVec3a, scratchVec3b, 0.01)) {
                        vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
                        vec3.normalize(scratchVec3a, scratchVec3a);
                    }
                }
            }
        }

        if (this.isUpdateChaseFrontVec(scratchVec3a)) {
            turnVecToVecCos(this.axisZ, this.axisZ, scratchVec3a, this.turnSpeed, this.gravityVector, 0.02);
        } else {
            vec3.copy(scratchVec3a, this.axisZ);
        }

        this.updateVelocity();
        this.updateRotateZ(scratchVec3a, deltaTimeFrames);
        return true;
    }

    private static isSensorType(sensor: HitSensor, table: HitSensorType[]): boolean {
        for (let i = 0; i < table.length; i++)
            if (sensor.isType(table[i]))
                return true;
        return false;
    }

    private static sensorTableTryExplosion: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.Rock,
        HitSensorType.Wanwan,
        HitSensorType.Karikari,
    ];

    private tryToExplosion(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): boolean {
        if (HomingKiller.isSensorType(otherSensor, HomingKiller.sensorTableTryExplosion) || isSensorEnemy(otherSensor))
            return sendMsgEnemyAttackExplosion(sceneObjHolder, otherSensor, thisSensor);
        else
            return false;
    }

    private sendMsgExplosionToNearActor(sceneObjHolder: SceneObjHolder): void {
        const eyeSensor = this.getSensor('eye')!;
        for (let i = 0; i < eyeSensor.pairwiseSensors.length; i++)
            if (isSensorNear(eyeSensor, eyeSensor.pairwiseSensors[i], 250.0))
                this.tryToExplosion(sceneObjHolder, eyeSensor, eyeSensor.pairwiseSensors[i]);
    }

    private static sensorTableAttackIfBinded: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.BreakableCage,
        HitSensorType.PunchBox,
        HitSensorType.TripodBossGuardWall,
        HitSensorType.TripodBossKillerGenerater,
        HitSensorType.MapObj,
    ];

    private tryBindedBreak(sceneObjHolder: SceneObjHolder): boolean {
        if (!isBinded(this))
            return false;

        const bodySensor = this.getSensor('body')!;

        if (isBindedGround(this))
            if (HomingKiller.isSensorType(this.binder!.floorHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.floorHitInfo.hitSensor!, bodySensor);
        if (isBindedWall(this))
            if (HomingKiller.isSensorType(this.binder!.wallHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.wallHitInfo.hitSensor!, bodySensor);
        if (isBindedRoof(this))
            if (HomingKiller.isSensorType(this.binder!.ceilingHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.ceilingHitInfo.hitSensor!, bodySensor);

        this.calcBinderFlag = false;
        return true;
    }

    private updateBaseMtxNoRotateZ(): void {
        if (isSameDirection(this.axisZ, this.axisY, 0.01)) {
            setMatrixTranslation(this.baseMtx, this.translation);
        } else {
            makeMtxFrontUpPos(this.baseMtx, this.axisZ, this.axisY, this.translation);
        }
    }
}

const enum HomingKillerLauncherNrv { AppearKiller, DeadKiller }
export class HomingKillerLauncher extends LiveActor<HomingKillerLauncherNrv> {
    private killer: HomingKiller;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'HomingKillerLauncher');

        connectToSceneEnemyMovement(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchReadAppear(sceneObjHolder, this, infoIter);
        // invalidateClipping()
        this.initNerve(HomingKillerLauncherNrv.AppearKiller);
        syncStageSwitchAppear(sceneObjHolder, this);

        this.killer = new HomingKiller(zoneAndLayer, sceneObjHolder, infoIter);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(HomingKillerLauncherNrv.AppearKiller);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerLauncherNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HomingKillerLauncherNrv.AppearKiller) {
            if (isFirstStep(this) && isDead(this.killer))
                this.killer.makeActorAppeared(sceneObjHolder);

            if (isDead(this.killer))
                this.setNerve(HomingKillerLauncherNrv.DeadKiller);
        } else if (currentNerve === HomingKillerLauncherNrv.DeadKiller) {
            if (isGreaterEqualStep(this, 180))
                this.setNerve(HomingKillerLauncherNrv.AppearKiller);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        if (getObjectName(infoIter) === 'Torpedo') {
            sceneObjHolder.modelCache.requestObjectData('TorpedoPropeller');
            sceneObjHolder.modelCache.requestObjectData('TorpedoLight');
        }
    }
}

export class DinoPackun extends LiveActor {
    public tail: PartsModel;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'DinoPackun');
        this.initModelManagerWithAnm(sceneObjHolder, 'DinoPackun');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initBinder(150, 150, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        initDefaultPos(sceneObjHolder, this, infoIter);
        // Todo: add tail joint controllers when JointController is implemented
        this.tail = createPartsModelEnemyAndFix(sceneObjHolder, this, 'DinoPackunTailBall', null, null, null, 'Tail7');
        startBck(this, 'Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('DinoPackun');
        sceneObjHolder.modelCache.requestObjectData('DinoPackunTailBall');
    }
}

export function turnVecToVecRadian(dst: vec3, src: ReadonlyVec3, target: ReadonlyVec3, speed: number, up: ReadonlyVec3): number {
    const dot = vec3.dot(src, target);

    const diffAngle = Math.acos(dot);
    if (isNearZero(diffAngle, 0.001))
        return 0.0;

    const turnAngle = Math.min(speed, diffAngle);
    const remaining = diffAngle - turnAngle;

    const canTurnTowardsTarget = dot >= 0 || !isSameDirection(src, target, 0.01);
    if (canTurnTowardsTarget) {
        quatSetRotate(scratchQuat, src, target, turnAngle / diffAngle);
    } else {
        quat.setAxisAngle(scratchQuat, up, turnAngle);
    }

    vec3.transformQuat(dst, src, scratchQuat);
    return remaining;
}

const enum TakoboNrv { Wait, Move, Attack }
const enum TakoboMoveDir { XForward, XBack, ZForward, ZBack }
export class Takobo extends LiveActor<TakoboNrv> {
    private frontVec = vec3.create();
    private moveDir = vec3.create();
    private moveIsGoingBack: boolean;
    private moveTime: number;
    private moveDistance: number;
    private moveTimeStep: number;
    private moveDistanceStart: number;
    private moveDistanceEnd: number;
    private initPos = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Takobo');

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.initPos, this.translation);
        const arg0 = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Takobo');
        connectToSceneEnemy(sceneObjHolder, this);

        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.frontVec, baseMtx);
        getMatrixAxisY(this.gravityVector, baseMtx);
        vec3.negate(this.gravityVector, this.gravityVector);

        const moveDir: TakoboMoveDir = fallback(getJMapInfoArg1(infoIter), TakoboMoveDir.ZForward);
        if (moveDir === TakoboMoveDir.XForward) {
            getMatrixAxisX(this.moveDir, baseMtx);
            this.moveIsGoingBack = false;
        } else if (moveDir === TakoboMoveDir.XBack) {
            getMatrixAxisX(this.moveDir, baseMtx);
            this.moveIsGoingBack = true;
        } else if (moveDir === TakoboMoveDir.ZForward) {
            getMatrixAxisZ(this.moveDir, baseMtx);
            this.moveIsGoingBack = false;
        } else if (moveDir === TakoboMoveDir.ZBack) {
            getMatrixAxisZ(this.moveDir, baseMtx);
            this.moveIsGoingBack = true;
        }
        this.moveTime = fallback(getJMapInfoArg2(infoIter), 5.0);
        this.moveDistance = fallback(getJMapInfoArg3(infoIter), 500.0);

        // declareStarPiece
        // declareCoin
        // initSound
        this.initBinder(80.0 * this.scale[1], 60.0 * this.scale[1], 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSensor()
        this.initHitSensor();
        vec3.set(scratchVec3, 0.0, 70.0 * this.scale[1], 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.Takobo, 32, scratchVec3[1], scratchVec3);
        // addHitSensorAtJointEnemyAttack

        initShadowVolumeSphere(sceneObjHolder, this, 70.0 * this.scale[1]);
        onCalcShadow(this);

        this.initNerve(TakoboNrv.Wait);
        initLightCtrl(sceneObjHolder, this);
        this.makeActorAppeared(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        calcGravity(sceneObjHolder, this);
        this.calcBinderFlag = false;
    }

    public calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.frontVec);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TakoboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TakoboNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                vec3.zero(this.velocity);
            }

            if (isGreaterEqualStep(this, 60)) {
                this.setNerve(TakoboNrv.Move);
            }
        } else if (currentNerve === TakoboNrv.Move) {
            if (isFirstStep(this)) {
                vec3.scale(scratchVec3, this.moveDir, this.moveDistance);
                vec3.sub(scratchVec3, this.initPos, scratchVec3);
                vec3.sub(scratchVec3, this.translation, scratchVec3);

                if (this.moveIsGoingBack) {
                    this.moveDistanceStart = -this.moveDistance;
                    this.moveDistanceEnd = -this.moveDistance + vec3.dot(scratchVec3, this.moveDir);
                } else {
                    this.moveDistanceEnd = this.moveDistance;
                    this.moveDistanceStart = -this.moveDistance +  vec3.dot(scratchVec3, this.moveDir);
                }
                this.moveTimeStep = (this.moveDistanceEnd - this.moveDistanceStart) / this.moveTime;
                this.moveTimeStep = (this.moveTimeStep * 1.3) | 0;
            }

            let moveT = calcNerveRate(this, this.moveTimeStep);
            if (this.moveIsGoingBack)
                moveT = 1.0 - moveT;

            const distance = getEaseInOutValue(moveT, this.moveDistanceStart, this.moveDistanceEnd);
            vec3.scaleAndAdd(scratchVec3, this.initPos, this.moveDir, distance);
            vec3.sub(this.velocity, scratchVec3, this.translation);

            if (isGreaterEqualStep(this, this.moveTimeStep)) {
                this.moveIsGoingBack = !this.moveIsGoingBack;
                this.setNerve(TakoboNrv.Move);
            } else {
                getPlayerPos(scratchVec3, sceneObjHolder);
                vec3.sub(scratchVec3, scratchVec3, this.translation);
                const distance = vec3.length(scratchVec3);
                vecKillElement(scratchVec3, scratchVec3, this.gravityVector);
                vec3.normalize(scratchVec3, scratchVec3);

                if (distance <= 250.0) {
                    const distance = turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3, 0.05, this.gravityVector);
                    if (distance < 0.1) {
                        this.setNerve(TakoboNrv.Attack);
                    }
                } else if (distance < 800.0) {
                    turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3, 0.05, this.gravityVector);
                }
            }
        } else if (currentNerve === TakoboNrv.Attack) {
            if (isFirstStep(this)) {
                startAction(this, 'Attack');
            }

            vec3.zero(this.velocity);
            if (isActionEnd(this)) {
                this.setNerve(TakoboNrv.Wait);
            } else if (isGreaterEqualStep(this, 90)) {
                // invalidate attack sensor
            } else if (isGreaterEqualStep(this, 85)) {
                setBckRate(this, 1.0);
                // validate attack sensor
            }
        }
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'TakoboDeath');
        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }
}
