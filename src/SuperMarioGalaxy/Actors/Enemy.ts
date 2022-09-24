
import { mat4, quat, ReadonlyMat4, ReadonlyQuat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderInstManager';
import { clamp, computeEulerAngleRotationFromSRTMatrix, computeModelMatrixR, computeModelMatrixT, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, invlerp, isNearZero, isNearZeroVec3, lerp, lerpAngle, MathConstants, normToLength, normToLengthAndAdd, quatFromEulerRadians, saturate, scaleMatrix, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, vec3SetAll, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from '../../MathHelpers';
import { assert, assertExists, fallback, nArray } from '../../util';
import * as Viewer from '../../viewer';
import { addVelocityFromPush, addVelocityFromPushHorizon, addVelocityMoveToDirection, addVelocityToGravity, appearStarPiece, attenuateVelocity, blendQuatUpFront, calcDistanceToPlayer, calcFrontVec, calcGravity, calcGravityVector, calcMtxFromGravityAndZAxis, calcNearestRailPos, calcNearestRailDirection, calcPerpendicFootToLine, calcRailPointPos, calcRailStartPos, calcSqDistanceToPlayer, calcUpVec, calcVelocityMoveToDirection, connectToScene, connectToSceneCollisionEnemyNoShadowedMapObjStrongLight, connectToSceneCollisionEnemyStrongLight, connectToSceneEnemy, connectToSceneEnemyMovement, connectToSceneIndirectEnemy, declareStarPiece, excludeCalcShadowToMyCollision, FixedPosition, getBckFrameMax, getBrkFrameMax, getCamYdir, getCamZdir, getCurrentRailPointArg0, getEaseInOutValue, getEaseInValue, getGroupFromArray, getJointMtxByName, getPlayerPos, getRailDirection, getRailPointNum, getRandomInt, getRandomVector, hideModel, initCollisionParts, initDefaultPos, invalidateShadowAll, isActionEnd, isBckOneTimeAndStopped, isBckPlaying, isBckStopped, isBrkStopped, isBtpStopped, isHiddenModel, isInDeath, isNearPlayer, isNearPlayerPose, isOnSwitchA, isSameDirection, isValidSwitchA, isValidSwitchAppear, isValidSwitchB, isValidSwitchDead, joinToGroupArray, listenStageSwitchOnOffA, listenStageSwitchOnOffB, makeMtxFrontUp, makeMtxFrontUpPos, makeMtxTRFromQuatVec, makeMtxUpFront, makeMtxUpFrontPos, makeMtxUpNoSupportPos, makeQuatFromVec, makeQuatUpFront, moveCoordAndFollowTrans, moveCoordAndTransToNearestRailPos, moveCoordAndTransToRailStartPoint, moveCoordToRailPoint, moveCoordToStartPos, moveTransToCurrentRailPos, quatFromMat4, quatGetAxisX, quatGetAxisY, quatGetAxisZ, quatSetRotate, reboundVelocityFromCollision, reboundVelocityFromEachCollision, restrictVelocity, reverseRailDirection, rotateQuatRollBall, sendMsgPushAndKillVelocityToTarget, setBckFrameAndStop, setBckRate, setBrkFrameAndStop, setBvaRate, setRailCoord, setRailCoordSpeed, setRailDirectionToEnd, showModel, startAction, startBck, startBckNoInterpole, startBckWithInterpole, startBpk, startBrk, startBtk, startBtp, startBtpIfExist, startBva, syncStageSwitchAppear, tryStartBck, turnVecToVecCos, turnVecToVecCosOnPlane, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB, useStageSwitchWriteDead, validateShadowAll, vecKillElement, setBtkFrameAndStop, getBckFrame, setBckFrame, isRailReachedGoal, isRailReachedNearGoal, setRailDirectionToStart, moveCoordToNearestPos, moveTransToOtherActorRailPos, moveCoord, calcNearestRailPosAndDirection, isLoopRail, isRailGoingToEnd, getRandomFloat, calcVecToPlayerH, calcVecFromPlayerH, calcDistanceToPlayerH, makeQuatSideUp, turnQuatYDirRad, setMtxQuat, calcRailEndPointDirection, rotateVecDegree, calcSideVec, connectToSceneMapObj, makeMtxSideUp, makeMtxSideFront, appearStarPieceToDirection, isNearPlayerAnyTime, addVelocityMoveToTarget, addVelocityAwayFromTarget, blendMtx, getRailPos, getRailTotalLength, connectToSceneMapObjDecorationStrongLight, connectToSceneMapObjMovement, getRailCoord, calcRailPosAtCoord, calcRailDirectionAtCoord, moveRailRider, getCurrentRailPointNo, getNextRailPointNo, moveCoordAndTransToRailPoint, getBckFrameMaxNamed, clampVecAngleDeg, connectToSceneEnvironment, isBtkExist, isBtkStopped, clampVecAngleRad, connectToSceneEnemyDecorationMovementCalcAnim, isExistRail, getRailPointArg0, getRailPointCoord } from '../ActorUtil';
import { isInAreaObj } from '../AreaObj';
import { CollisionKeeperCategory, getFirstPolyOnLineToMapExceptSensor, isBinded, isBindedGround, isBindedRoof, isBindedWall, isGroundCodeDamage, isGroundCodeDamageFire, isGroundCodeAreaMove, isGroundCodeRailMove, isOnGround, Triangle, TriangleFilterFunc, isBindedGroundDamageFire, isBindedGroundWaterBottomH, isBindedGroundWaterBottomM, isBindedWallOfMoveLimit, getGroundNormal, isExistMapCollision, isExistMoveLimitCollision, getFirstPolyOnLineToMap, setBinderOffsetVec, setBinderExceptActor, setBinderIgnoreMovingCollision, setBinderRadius } from '../Collision';
import { deleteEffect, deleteEffectAll, emitEffect, emitEffectHitMtx, forceDeleteEffect, forceDeleteEffectAll, isEffectValid, setEffectHostMtx, setEffectHostSRT } from '../EffectSystem';
import { initFur } from '../Fur';
import { addBodyMessageSensorMapObjPress, addHitSensor, addHitSensorAtJoint, addHitSensorAtJointEnemy, addHitSensorEnemyAttack, addHitSensorAtJointEnemyAttack, addHitSensorEnemy, addHitSensorEye, addHitSensorMapObj, addHitSensorPush, HitSensor, HitSensorType, invalidateHitSensor, invalidateHitSensors, isSensorEnemy, isSensorMapObj, isSensorNear, isSensorPlayer, isSensorPlayerOrRide, isSensorRide, sendMsgEnemyAttack, sendMsgEnemyAttackExplosion, sendMsgPush, sendMsgToGroupMember, validateHitSensors, isSensorEnemyAttack, addHitSensorMtxEnemy, addHitSensorMtxEnemyAttack, sendMsgEnemyAttackStrong, isSensorPressObj, clearHitSensors, sendMsgEnemyAttackElectric, addHitSensorMtx, addBodyMessageSensorEnemy, calcSensorDirectionNormalize, setSensorRadius } from '../HitSensor';
import { getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoArg7, getJMapInfoBool, iterChildObj, JMapInfoIter } from '../JMapInfo';
import { initLightCtrl } from '../LightData';
import { dynamicSpawnZoneAndLayer, isDead, isMsgTypeEnemyAttack, LiveActor, LiveActorGroup, makeMtxTRFromActor, MessageType, resetPosition, ZoneAndLayer } from '../LiveActor';
import { getObjectName, SceneObj, SceneObjHolder } from '../Main';
import { MapPartsRailMover, MapPartsRailPointPassChecker } from '../MapParts';
import { getWaterAreaInfo, isCameraInWater, isInWater, WaterInfo } from '../MiscMap';
import { CalcAnimType, DrawBufferType, DrawType, MovementType } from '../NameObj';
import { getRailArg, isConnectedWithRail } from '../RailRider';
import { getShadowProjectedSensor, getShadowProjectionPos, initShadowFromCSV, initShadowVolumeOval, initShadowVolumeSphere, isShadowProjected, onCalcShadow, offCalcShadow, setShadowDropLength, getShadowNearProjectionLength, getShadowProjectionLength, initShadowVolumeFlatModel, initShadowController, addShadowVolumeFlatModel, addShadowVolumeBox, setShadowDropPosition, setShadowVolumeBoxSize, onCalcShadowDropPrivateGravity, setShadowDropPositionPtr, addShadowSurfaceCircle, setShadowDropStartOffset, addShadowVolumeSphere, setShadowVolumeSphereRadius } from '../Shadow';
import { calcNerveRate, isCrossedRepeatStep, isCrossedStep, isFirstStep, isGreaterEqualStep, isGreaterStep, isLessStep, NerveExecutor } from '../Spine';
import { appearCoinPop, appearCoinPopToDirection, declareCoin, isEqualStageName, ParabolicPath } from './MiscActor';
import { createModelObjBloomModel, createModelObjMapObj, ModelObj } from './ModelObj';
import { getWaterAreaObj } from '../MiscMap';
import { J3DModelData } from '../../Common/JSYSTEM/J3D/J3DGraphBase';
import { drawWorldSpaceBasis, drawWorldSpaceFan, drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, drawWorldSpaceVector, getDebugOverlayCanvas2D } from '../../DebugJunk';
import { Blue, Green, Red, White } from '../../Color';
import { PartsModel } from './PartsModel';

// Scratchpad
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
        this.makeActorAppeared(sceneObjHolder);

        this.calcParameters(sceneObjHolder);
    }

    private calcParameters(sceneObjHolder: SceneObjHolder): void {
        vec3.set(scratchVec3a, 0.0, this.upperHeight, 0.0);
        transformVec3Mat4w0(scratchVec3a, this.getBaseMtx()!, scratchVec3a);
        vec3.add(this.upperPos, this.lowerPos, scratchVec3a);

        const fallingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 30.0;
        this.maxFallingStep = this.upperHeight / fallingSpeed;

        const risingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 25.0;
        this.maxRisingStep = this.upperHeight / risingSpeed;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: DossunNrv, deltaTimeFrames: number): void {
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
    protected rotationAxis = vec3.create();
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

    protected override calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
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

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: OnimasuNrv, deltaTimeFrames: number): void {
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
                this.calcTargetPose();
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

    private calcTargetPose(): void {
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

        quatGetAxisZ(scratchVec3a, this.poseQuatLast);
        quatGetAxisZ(scratchVec3b, this.poseQuatNext);
        if (isSameDirection(scratchVec3a, scratchVec3b, 0.01)) {
            quat.setAxisAngle(scratchQuat, this.rotationAxis, Math.PI / 1000.0);
            quat.mul(this.poseQuatLast, scratchQuat, this.poseQuatLast);
        }
    }

    private updatePose(sceneObjHolder: SceneObjHolder): void {
        const step = this.getTimeToNextPoint(sceneObjHolder);
        const t = saturate(this.getNerveStep() / step);
        quat.slerp(this.poseQuat, this.poseQuatLast, this.poseQuatNext, t);
    }

    private emitEffectLand(sceneObjHolder: SceneObjHolder): void {
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(scratchVec3a, this, nextPointNo);

        const normal = this.getNextPointNormal();
        // Original game does -normal * 800 * 0.5, likely to center.
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, normal, -400.0);

        if (isSameDirection(this.rotationAxis, normal, 0.01)) {
            makeMtxUpNoSupportPos(this.effectHostMtx, normal, scratchVec3a);
        } else {
            // TODO(jstpierre): makeMtxUpSidePos
            makeMtxUpFrontPos(this.effectHostMtx, normal, this.rotationAxis, scratchVec3a);
        }

        emitEffect(sceneObjHolder, this, 'Move');
    }

    private land(sceneObjHolder: SceneObjHolder): void {
        this.emitEffectLand(sceneObjHolder);
        // startRumbleWithShakeCameraNormalWeak
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(this.translation, this, nextPointNo);
        vec3.zero(this.velocity);
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

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Onimasu');
    }
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
            getPolygonOnRailPoint(sceneObjHolder, scratchVec3a, this.normals[i], this, i);
    }

    protected incrementNextPoint(): void {
        this.nextPointNo++;
        if (this.nextPointNo >= this.pointCount)
            this.nextPointNo = 0;
    }

    protected getLastPointNo(): number {
        let lastPointNo = this.nextPointNo - 1;
        if (lastPointNo < 0)
            lastPointNo += this.pointCount;
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
        this.calcGravityDir(scratchVec3a);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, 1.0);
    }

    protected startMoveInner(sceneObjHolder: SceneObjHolder): void {
        calcRailPointPos(scratchVec3a, this, this.nextPointNo);

        const distance = vec3.distance(scratchVec3a, this.translation);
        const timeToNextPoint = this.getTimeToNextPoint(sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        normToLength(scratchVec3a, distance / timeToNextPoint);

        this.calcGravityDir(scratchVec3b);
        vec3.scale(scratchVec3b, scratchVec3b, -0.5 * timeToNextPoint);

        vec3.add(this.velocity, scratchVec3a, scratchVec3b);
    }
}

export class OnimasuPivot extends Onimasu {
    private pointCount: number;
    private normals: vec3[];
    private nextPointNo: number = 0;
    private poseLastPoint = quat.create();
    private poseNextPoint = quat.create();

    protected initFromRailPoint(sceneObjHolder: SceneObjHolder): void {
        this.pointCount = getRailPointNum(this) / 2;
        this.normals = nArray(this.pointCount, () => vec3.create());
    }

    protected collectRailPointInfo(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.pointCount; i++)
            getPolygonOnRailPoint(sceneObjHolder, scratchVec3a, this.normals[i], this, i * 2);
    }

    protected incrementNextPoint(): void {
        this.nextPointNo++;
        if (this.nextPointNo >= this.pointCount)
            this.nextPointNo = 0;
    }

    protected getLastPointNo(): number {
        let lastPointNo = this.nextPointNo - 1;
        if (lastPointNo < 0)
            lastPointNo += this.pointCount;
        return lastPointNo;
    }

    protected getLastPointNormal(): vec3 {
        return this.normals[this.getLastPointNo()];
    }

    protected getNextPointNo(): number {
        return this.nextPointNo * 2;
    }

    protected getNextPointNormal(): vec3 {
        return this.normals[this.nextPointNo];
    }

    protected updatePoseInner(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        const timeToNextPoint = this.getTimeToNextPoint(sceneObjHolder);

        const t = saturate(this.getNerveStep() / timeToNextPoint);
        quat.slerp(scratchQuat, this.poseLastPoint, this.poseNextPoint, t);

        quatGetAxisZ(scratchVec3a, scratchQuat);
        normToLength(scratchVec3a, 565.6854);

        const lastPointNo = this.getLastPointNo();
        calcRailPointPos(this.translation, this, lastPointNo * 2 + 1);
        vec3.add(this.translation, this.translation, scratchVec3a);
    }

    protected startMoveInner(sceneObjHolder: SceneObjHolder): void {
        const lastPointNo = this.getLastPointNo();
        calcRailPointPos(scratchVec3a, this, lastPointNo * 2 + 1);
        calcRailPointPos(scratchVec3b, this, lastPointNo * 2);
        calcRailPointPos(scratchVec3c, this, this.getNextPointNo());

        vec3.sub(scratchVec3b, scratchVec3b, scratchVec3a);
        vec3.sub(scratchVec3c, scratchVec3c, scratchVec3a);

        if (isSameDirection(scratchVec3b, scratchVec3b, 0.01)) {
            mat4.fromRotation(scratchMatrix, Math.PI / 1000.0, this.rotationAxis);
            transformVec3Mat4w0(scratchVec3b, scratchMatrix, scratchVec3b);
        }

        makeQuatFromVec(this.poseLastPoint, scratchVec3b, this.rotationAxis);
        makeQuatFromVec(this.poseNextPoint, scratchVec3c, this.rotationAxis);
    }
}

const enum RingBeamNrv { Spread }
class RingBeam extends LiveActor<RingBeamNrv> {
    private axisZ = vec3.create();
    private farPointPos = vec3.create();
    private farPointAxisY = vec3.create();
    private staticShadow: ModelObj | null = null;
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

        if (this.useStaticShadow) {
            this.staticShadow = new ModelObj(zoneAndLayer, sceneObjHolder, `JumpBeamerBeamShadow`, `JumpBeamerBeamShadow`, null, DrawBufferType.IndirectEnemy, MovementType.Enemy, CalcAnimType.Enemy);
            vec3.copy(this.staticShadow.translation, this.translation);
            vec3.copy(this.staticShadow.rotation, this.rotation);
            vec3.copy(this.staticShadow.scale, this.scale);
        }

        this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, 'JumpBeamerBeamBloom', 'JumpBeamerBeamBloom', this.getBaseMtx()!);
        this.makeActorDead(sceneObjHolder);
    }

    public setSpeed(speed: number): void {
        this.speed = speed;
    }

    public setLife(life: number): void {
        this.life = life;
    }

    private startBrk(name: string): void {
        startBrk(this, name);
        if (this.staticShadow !== null)
            startBrk(this.staticShadow, name);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamNrv, deltaTimeFrames: number): void {
        if (currentNerve === RingBeamNrv.Spread) {
            if (isFirstStep(this)) {
                startBckNoInterpole(this, 'Spread');
                startBckNoInterpole(this.bloomModel, 'Spread');

                this.startBrk('Erase');
                setBrkFrameAndStop(this, 0);
                if (this.staticShadow !== null)
                    setBrkFrameAndStop(this.staticShadow, 0);

                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisZ(this.axisZ, baseMtx);
                getMatrixAxisY(scratchVec3a, baseMtx);
                vec3.scaleAndAdd(this.farPointPos, this.parentActor.translation, scratchVec3a, 75.0);
            }

            if (this.useFancyPosCalc) {
                vec3.scaleAndAdd(scratchVec3c, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
                calcGravityVector(sceneObjHolder, this, scratchVec3c, this.farPointAxisY);
                vec3.negate(this.farPointAxisY, this.farPointAxisY);
                makeMtxUpFront(scratchMatrix, this.farPointAxisY, this.axisZ);
                getMatrixAxisZ(this.axisZ, scratchMatrix);
                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisY(scratchVec3c, baseMtx);
                vec3.scaleAndAdd(scratchVec3a, this.parentActor.translation, scratchVec3c, 1.0);
                vec3.scaleAndAdd(scratchVec3b, this.parentActor.translation, scratchVec3c, -1.0);
                calcPerpendicFootToLine(this.translation, this.farPointPos, scratchVec3a, scratchVec3b);
            }

            vec3.scaleAndAdd(this.farPointPos, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
            this.setRadius(sceneObjHolder, vec3.distance(this.farPointPos, this.translation));

            // transSound

            if (isCrossedStep(this, this.life - getBrkFrameMax(this)))
                this.startBrk('Erase');

            if (isGreaterEqualStep(this, this.life))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.bloomModel.makeActorAppeared(sceneObjHolder);
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(RingBeamNrv.Spread);
        this.initPos(this.parentActor);
        this.setRadius(sceneObjHolder, 0);
        super.makeActorDead(sceneObjHolder);
        this.bloomModel.makeActorDead(sceneObjHolder);
    }

    private initPos(actor: LiveActor): void {
        const baseMtx = actor.getBaseMtx()!;
        getMatrixAxisY(scratchVec3a, baseMtx);
        vec3.scaleAndAdd(this.translation, actor.translation, scratchVec3a, 50.0);
    }

    private setRadius(sceneObjHolder: SceneObjHolder, radius: number): void {
        radius = Math.min(radius, 2000.0);
        startBckNoInterpole(this, 'Spread');
        startBckNoInterpole(this.bloomModel, 'Spread');
        const frame = (radius / 2000.0) * getBckFrameMax(this);
        setBckFrameAndStop(this, frame);
        setBckFrameAndStop(this.bloomModel, frame);

        if (this.staticShadow !== null) {
            vec3.scale(scratchVec3a, this.gravityVector, 500.0);
            getFirstPolyOnLineToMap(sceneObjHolder, scratchVec3a, null, this.farPointPos, scratchVec3a);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, this.gravityVector, -10.0);

            getMatrixAxisY(scratchVec3b, this.getBaseMtx()!);
            vec3.scaleAndAdd(scratchVec3c, this.translation, scratchVec3b, 1000.0);
            vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3b, -1000.0);

            calcPerpendicFootToLine(this.staticShadow.translation, scratchVec3a, scratchVec3b, scratchVec3c);
            startBckNoInterpole(this, 'Spread');
            const t = invlerp(0.0, 2000.0, vec3.distance(this.staticShadow.translation, scratchVec3a));
            if (t >= 0.0 && t < 1.0)
                setBckFrameAndStop(this.staticShadow, lerp(0, getBckFrameMax(this.staticShadow), t));
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, useStaticShadow: boolean = false): void {
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeam');
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeamBloom');
        if (useStaticShadow)
            sceneObjHolder.modelCache.requestObjectData(`JumpBeamerBeamShadow`);
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
    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: BallBeamerNrv, deltaTimeFrames: number): void {
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

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const useStaticShadow = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        RingBeam.requestArchives(sceneObjHolder, null, useStaticShadow);
    }
}

function enableGroupAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, radius: number, thresholdY: number): boolean {
    if (isValidSwitchA(actor) && !actor.stageSwitchCtrl!.isOnSwitchA(sceneObjHolder))
        return false;
    if (isValidSwitchB(actor) && !actor.stageSwitchCtrl!.isOnSwitchB(sceneObjHolder))
        return false;

    const actorGroup = getGroupFromArray(sceneObjHolder, actor);
    if (actorGroup !== null)
        for (let i = 0; i < actorGroup.objArray.length; i++)
            if (calcSqDistanceToPlayer(sceneObjHolder, actorGroup.objArray[i]) < calcSqDistanceToPlayer(sceneObjHolder, actor))
                actor = actorGroup.objArray[i];

    return isNearPlayerPose(sceneObjHolder, actor, radius, thresholdY);
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
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 80.0, 0.0);
        addHitSensorPush(sceneObjHolder, this, 'body', 8, 160.0, scratchVec3a);
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

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamerNrv, deltaTimeFrames: number): void {
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

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
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

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        RingBeam.requestArchives(sceneObjHolder, null, false);
    }
}

function chaseAngle(v0: number, v1: number, maxSpeed: number, maxAngle: number = MathConstants.TAU): number {
    const da = (v1 - v0) % maxAngle;
    const dist = (2*da) % maxAngle - da;
    if (Math.abs(dist) >= maxSpeed)
        return v0 + Math.sign(dist) * maxSpeed;
    else
        return v1;
}

const enum JumpBeamerNrv { Hide, Up, Wait, PreOpen, Open, Close, Inter, Down }
export class JumpBeamer extends LiveActor<JumpBeamerNrv> {
    private headMtx = mat4.create();
    private topMtx: mat4;
    private headModel: PartsModel;
    private ringBeams: RingBeam[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'JumpBeamerBody');

        this.initModelManagerWithAnm(sceneObjHolder, 'JumpBeamerBody');
        this.headModel = new PartsModel(sceneObjHolder, `JumpBeamerHead`, `JumpBeamerHead`, this, DrawBufferType.MapObjStrongLight, this.headMtx);
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneEnemy(sceneObjHolder, this);
        this.initHitSensor();
        initLightCtrl(sceneObjHolder, this);
        const jumpSensor = addHitSensorMtx(sceneObjHolder, this, `Jump`, HitSensorType.PlayerAutoJump, 8, getJointMtxByName(this, `SpringJoint3`)!, 145.0, vec3.set(scratchVec3a, 0.0, -100.0, 0.0));
        jumpSensor.invalidate();
        addHitSensorMtx(sceneObjHolder, this, `body`, HitSensorType.Begoman, 8, getJointMtxByName(this, `Body`)!, 145.0, vec3.set(scratchVec3a, 0, 35.0, 0.0));

        initShadowVolumeSphere(sceneObjHolder, this, 140.0);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(JumpBeamerNrv.Hide);
        startBckWithInterpole(this, `Down`, 0);
        setBckFrame(this, getBckFrameMax(this) - 1);
        this.calcAnim(sceneObjHolder);
        this.topMtx = getJointMtxByName(this, 'Top')!;

        this.makeActorAppeared(sceneObjHolder);

        const ringBeamSpeed = fallback(getJMapInfoArg0(infoIter), 20.0);
        const ringBeamLife = fallback(getJMapInfoArg1(infoIter), 100);
        for (let i = 0; i < 5; i++) {
            const ringBeam = new RingBeam(zoneAndLayer, sceneObjHolder, infoIter, this, false, false);
            ringBeam.setSpeed(ringBeamSpeed);
            ringBeam.setLife(ringBeamLife);
            this.ringBeams.push(ringBeam);
        }
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        mat4.copy(this.headMtx, this.topMtx);
    }

    private updateRotate(sceneObjHolder: SceneObjHolder): void {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        scratchVec3a[1] = 0.0;
        const targetY = Math.atan2(scratchVec3a[0], scratchVec3a[2]);

        const maxSpeed = 3.0 * MathConstants.DEG_TO_RAD;
        this.rotation[1] = chaseAngle(this.rotation[1], targetY, maxSpeed);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: JumpBeamerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === JumpBeamerNrv.Hide) {
            this.updateRotate(sceneObjHolder);

            if (isFirstStep(this)) {
                startBck(this.headModel, `Wait`);
                startBrk(this.headModel, `Green`);
                setShadowVolumeSphereRadius(this, null, 110.0);
            }

            // TODO(jstpierre): Check switches
            if (enableGroupAttack(sceneObjHolder, this, 3000.0, 500.0))
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncAttack, this, this.getSensor('body')!, 'body');
        } else if (currentNerve === JumpBeamerNrv.Up) {
            if (isFirstStep(this)) {
                startBck(this, 'Up');
                validateShadowAll(this);
            }

            const shadowSize = lerp(30.0, 140.0, getBckFrame(this) / getBckFrameMax(this));
            setShadowVolumeSphereRadius(this, null, shadowSize);

            if (isBckStopped(this)) {
                invalidateShadowAll(this);
                this.setNerve(JumpBeamerNrv.Wait);
            }
        } else if (currentNerve === JumpBeamerNrv.Wait) {
            this.updateRotate(sceneObjHolder);

            if (!enableGroupAttack(sceneObjHolder, this, 3200.0, 500.0)) {
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncInter, this, this.getSensor('body')!, 'body');
                return;
            }

            // TODO(jstpierre): Check switches
            this.setNerve(JumpBeamerNrv.PreOpen);
        } else if (currentNerve === JumpBeamerNrv.PreOpen) {
            this.updateRotate(sceneObjHolder);

            if (!enableGroupAttack(sceneObjHolder, this, 3200.0, 500.0)) {
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncInter, this, this.getSensor('body')!, 'body');
                return;
            }

            if (isGreaterEqualStep(this, 0))
                this.setNerve(JumpBeamerNrv.Open);
        } else if (currentNerve === JumpBeamerNrv.Open) {
            if (isFirstStep(this))
                startBck(this, 'Open');

            if (isGreaterEqualStep(this, 240)) {
                this.setNerve(JumpBeamerNrv.Close);
                return;
            }

            if (isCrossedRepeatStep(this, 80))
                emitEffect(sceneObjHolder, this, 'Charge');

            if (isCrossedRepeatStep(this, 80, 79)) {
                deleteEffect(sceneObjHolder, this, 'Charge');
                const whichBeam = (this.getNerveStep() / 80) | 0;
                this.ringBeams[whichBeam].makeActorAppeared(sceneObjHolder);
            }
        } else if (currentNerve === JumpBeamerNrv.Close) {
            this.setNerve(JumpBeamerNrv.Inter);
        } else if (currentNerve === JumpBeamerNrv.Inter) {
            // TODO(jstpierre): Check switches
            this.updateRotate(sceneObjHolder);

            if (!enableGroupAttack(sceneObjHolder, this, 3200.0, 500.0)) {
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncInter, this, this.getSensor('body')!, 'body');
                return;
            }

            if (isGreaterEqualStep(this, 80)) {
                for (let i = 0; i < this.ringBeams.length; i++)
                    if (!isDead(this.ringBeams[i]))
                        return;

                this.setNerve(JumpBeamerNrv.Wait);
            }
        } else if (currentNerve === JumpBeamerNrv.Down) {
            if (isFirstStep(this))
                startBck(this, 'Down');

            const shadowSize = lerp(140.0, 30.0, getBckFrame(this) / getBckFrameMax(this));
            setShadowVolumeSphereRadius(this, null, shadowSize);

            if (isBckStopped(this))
                this.setNerve(JumpBeamerNrv.Hide);
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.RingBeamer_SyncAttack) {
            this.setNerve(JumpBeamerNrv.Up);
            return true;
        } else if (messageType === MessageType.RingBeamer_SyncInter) {
            this.setNerve(JumpBeamerNrv.Down);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(`JumpBeamerBody`);
        sceneObjHolder.modelCache.requestObjectData(`JumpBeamerHead`);
        RingBeam.requestArchives(sceneObjHolder, null, false);
    }
}

function trySetMoveLimitCollision(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    const collisionDirector = sceneObjHolder.collisionDirector;
    if (collisionDirector === null)
        return false;

    vec3.scaleAndAdd(scratchVec3a, actor.translation, actor.gravityVector, -150.0);
    vec3.scaleAndAdd(scratchVec3b, actor.translation, actor.gravityVector, 1000.0);

    const moveLimitKeeper = collisionDirector.keepers[CollisionKeeperCategory.MoveLimit];
    const mapKeeper = collisionDirector.keepers[CollisionKeeperCategory.Map];
    if (moveLimitKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        actor.binder!.setExCollisionParts(moveLimitKeeper.strikeInfo[0].collisionParts!);
        return true;
    } else if (mapKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        const mapCollisionParts = mapKeeper.strikeInfo[0].collisionParts!;
        const exParts = moveLimitKeeper.searchSameHostParts(mapCollisionParts);
        actor.binder!.setExCollisionParts(exParts);
        return true;
    } else {
        return false;
    }
}

function turnMtxToYDir(dst: mat4, v: ReadonlyVec3, rad: number): void {
    quatFromMat4(scratchQuat, dst);
    turnQuatYDirRad(scratchQuat, scratchQuat, v, rad);
    setMtxQuat(dst, scratchQuat);
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
    private isJumping = false;
    private chaseSinTimer = 0;
    private waterInfo = new WaterInfo();

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
        vec3SetAll(this.scale, 1.0);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 126.36 * this.size, 0.0);
        addHitSensor(sceneObjHolder, this, 'Body', HitSensorType.Unizo, 8, 115.2 * this.size, scratchVec3a);
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

    public override getBaseMtx(): mat4 {
        return this.baseMtx;
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        mat4.fromQuat(scratchMatrix, this.rollRotation);
        getMatrixAxisY(scratchVec3a, scratchMatrix);
        vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3a, -126.36 * this.size);

        getMatrixAxisY(scratchVec3a, this.baseMtx);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3b, scratchVec3a, 126.36 * this.size /* * this.animScaleController.scale[1] */);

        const wobbleY = this.size * Math.sin(this.chaseSinTimer / 60) * this.wobbleY;

        vecKillElement(scratchVec3a, this.velocity, this.gravityVector);
        const velWobbleY = Math.min(vec3.length(scratchVec3a) * 0.25, 1.0);

        vec3.scaleAndAdd(scratchVec3b, scratchVec3b, this.gravityVector, velWobbleY * wobbleY);
        setMatrixTranslation(scratchMatrix, scratchVec3b);
        mat4.copy(this.modelInstance!.modelMatrix, scratchMatrix);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        validateShadowAll(this);
        validateShadowAll(this.breakModel);

        showModel(this);
        setMatrixTranslation(this.baseMtx, this.translation);
        super.makeActorAppeared(sceneObjHolder);

        quatFromEulerRadians(this.rollRotation, this.rotation[0], this.rotation[1], this.rotation[2]);
        quat.normalize(this.rollRotation, this.rollRotation);
        vec3.zero(this.rotation);

        this.isJumping = true;
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        validateHitSensors(this);
        this.breakModel.makeActorDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        this.chaseSinTimer += sceneObjHolder.deltaTimeFrames;

        if (!isNearZeroVec3(this.velocity, 0.001))
            this.updateRotate();

        vec3.negate(scratchVec3a, this.gravityVector);
        turnMtxToYDir(this.baseMtx, scratchVec3a, 1.0 * MathConstants.DEG_TO_RAD);
        setMatrixTranslation(this.baseMtx, this.translation);
        this.updateSurfaceEffect(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: UnizoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === UnizoNrv.Wait) {
            if (isFirstStep(this))
                startBtp(this, 'Normal');

            this.updateBlink();
            this.updateInfluence(sceneObjHolder);

            if (!this.isJumping && isBindedGround(this) && isNearPlayer(sceneObjHolder, this, 1500.0) /* && isPlayerDamaging() */) {
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

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
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

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.EnemyAttack) {
            if (otherSensor!.isType(HitSensorType.Unizo)) {
                vec3.sub(scratchVec3a, thisSensor!.center, otherSensor!.center);
                const dist = vec3.length(scratchVec3a);
                vec3.normalize(scratchVec3a, scratchVec3a);
                addVelocityMoveToDirection(this, scratchVec3a, dist * 0.2);
                if (!isBckPlaying(this, 'Shock'))
                    startBck(this, 'Shock');
            } else {
                this.doBreak(sceneObjHolder);
            }

            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private doJump(): void {
        this.isJumping = true;

        const jumpHeight = Math.sqrt(2.0 * this.size * (70.0 * this.jumpHeight * vec3.length(this.gravityVector)));
        vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -jumpHeight);
    }

    private doBreak(sceneObjHolder: SceneObjHolder): void {
        if (this.name === 'Unizo')
            appearStarPiece(sceneObjHolder, this, this.translation, 7, 10.0, 40.0, false);
        else
            appearStarPiece(sceneObjHolder, this, this.translation, 7, 10.0, 40.0, true);

        this.appearBreakModel(sceneObjHolder);

        if (this.name === 'Unizo') {
            startBck(this.breakModel, 'Break');
            startBrk(this.breakModel, 'Break');
            emitEffect(sceneObjHolder, this, 'Death');
        } else if (this.name === 'UnizoLand') {
            startBck(this.breakModel, 'FireDown');
            startBrk(this.breakModel, 'FireDown');
        } else if (this.name === 'UnizoShoal') {
            startBck(this.breakModel, 'Break');
            startBrk(this.breakModel, 'Break');
        }

        this.breakModel.makeActorAppeared(sceneObjHolder);
        this.setNerve(UnizoNrv.Break);
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
        getPlayerPos(scratchVec3b, sceneObjHolder);
        vec3.sub(scratchVec3b, scratchVec3b, this.translation);
        vecKillElement(scratchVec3b, scratchVec3b, this.gravityVector);
        vec3.normalize(scratchVec3b, scratchVec3b);

        const chaseAngle = (MathConstants.TAU / 4) * Math.sin(this.chaseSinTimer / 20.0) * (vec3.length(this.velocity) * 0.25);
        mat4.fromRotation(scratchMatrix, chaseAngle, this.gravityVector);
        transformVec3Mat4w0(scratchVec3b, scratchMatrix, scratchVec3b);
        setMatrixTranslation(scratchMatrix, this.translation);
        // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.translation, isBindedGround(this) ? Green : Red);

        if (vec3.dot(scratchVec3b, this.velocity) <= 0.0 || vec3.squaredLength(this.velocity) < 4.0**2)
            addVelocityMoveToDirection(this, scratchVec3b, 0.1);
    }

    private updateInfluence(sceneObjHolder: SceneObjHolder): void {
        if (!this.isJumping) {
            reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);

            if (isBindedGround(this))
                addVelocityToGravity(this, 0.2);
            else
                addVelocityToGravity(this, 0.8);
        } else {
            addVelocityToGravity(this, this.jumpHeight);
            reboundVelocityFromCollision(this, 0.6, 0.0, 1.0);
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

                this.isJumping = false;
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
        vec3.negate(scratchVec3a, this.gravityVector);
        rotateQuatRollBall(this.rollRotation, this.velocity, scratchVec3a, 126.26 * this.size);
    }

    private updateSurfaceEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.name !== 'UnizoShoal')
            return;

        if (getWaterAreaObj(this.waterInfo, sceneObjHolder, this.translation)) {
            getWaterAreaInfo(this.waterInfo, this.translation, this.gravityVector);
            // TOOD(jstpierre): SurfacePos
        } else {
            deleteEffect(sceneObjHolder, this, 'Ripple');
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
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
        getRandomVector(scratchVec3a, 1.0);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
        vec3.scaleAndAdd(this.targetPos, this.center, scratchVec3a, this.radius);
    }

    public isReachedTarget(actor: LiveActor, dist: number): boolean {
        vec3.sub(scratchVec3a, actor.translation, this.targetPos);
        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
        return vec3.squaredLength(scratchVec3a) < dist**2.0;
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
    sightFanRadius: number;
    sightFanAngleH: number;
    sightFanAngleV: number;
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
    vec3.sub(scratchVec3a, targetPos, actor.translation);
    const speed = Math.cos(MathConstants.DEG_TO_RAD * speedInDegrees);
    const plane = isBindedGround(actor) ? getGroundNormal(actor) : actor.gravityVector;
    return turnVecToVecCosOnPlane(dst, dst, scratchVec3a, plane, speed);
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

function isFaceToPlayerHorizontalDegree(sceneObjHolder: SceneObjHolder, actor: LiveActor, direction: ReadonlyVec3, degrees: number): boolean {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    return isFaceToTargetHorizontalDegree(actor, scratchVec3a, direction, degrees);
}

function isFallNextMove(sceneObjHolder: SceneObjHolder, position: ReadonlyVec3, velocity: ReadonlyVec3, gravity:ReadonlyVec3, horizontalSpeed: number, upPosDistance: number, downSearchDistance: number, filter: TriangleFilterFunc | null = null): boolean {
    if (sceneObjHolder.collisionDirector === null)
        return false;

    if (isNearZeroVec3(gravity, 0.001))
        return false;

    vecKillElement(scratchVec3a, velocity, gravity);
    if (isNearZeroVec3(scratchVec3a, 0.001))
        return false;

    normToLength(scratchVec3a, horizontalSpeed);

    vec3.add(scratchVec3a, position, scratchVec3a);
    vec3.scaleAndAdd(scratchVec3a, scratchVec3a, gravity, -upPosDistance);

    vec3.scale(scratchVec3b, gravity, upPosDistance + downSearchDistance);
    const numHitInfo = sceneObjHolder.collisionDirector.keepers[0].checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b, null, filter);
    // drawWorldSpaceVector(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, 1.0, numHitInfo ? Green : Red);
    return numHitInfo === 0;
}

function isFallNextMoveActor(sceneObjHolder: SceneObjHolder, actor: Readonly<LiveActor>, horizontalSpeed: number, upPosDistance: number, downSearchDistance: number, filter: TriangleFilterFunc | null = null): boolean {
    return isFallNextMove(sceneObjHolder, actor.translation, actor.velocity, actor.gravityVector, horizontalSpeed, upPosDistance, downSearchDistance, filter);
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

    public override appear(): void {
        super.appear();
        this.setNerve(WalkerStateWanderNrv.Wait);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateWanderNrv, deltaTimeFrames: number): void {
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

            if (isFallNextMoveActor(sceneObjHolder, this.actor, 150.0, 150.0, 150.0)) {
                vec3.zero(this.actor.velocity);
                this.setNerve(WalkerStateWanderNrv.Wait);
            } else if (this.territoryMover.isReachedTarget(this.actor, this.paramWander.targetRadius) || isGreaterStep(this, this.paramWander.walkStep)) {
                this.setNerve(WalkerStateWanderNrv.Wait);
            }
        }
    }
}

interface WalkerStateFindPlayerParam {
    turnSpeedDegrees: number;
    jumpStartStep: number;
    jumpVelocity: number;
}

enum WalkerStateFindPlayerNrv { Find, FindJumpStart, FindJump, FindJumpEnd }
class WalkerStateFindPlayer extends ActorStateBaseInterface<WalkerStateFindPlayerNrv> {
    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramFindPlayer: WalkerStateFindPlayerParam) {
        super();

        this.initNerve(WalkerStateFindPlayerNrv.Find);
    }

    public isInSightPlayer(sceneObjHolder: SceneObjHolder): boolean {
        return isInSightFanPlayer(sceneObjHolder, this.actor, this.front, this.param.sightFanRadius, this.param.sightFanAngleH, this.param.sightFanAngleV);
    }

    public override appear(): void {
        super.appear();
        this.setNerve(WalkerStateFindPlayerNrv.Find);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateFindPlayerNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateFindPlayerNrv.Find) {
            if (isFirstStep(this))
                startAction(this.actor, 'Turn');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, scratchVec3a, this.paramFindPlayer.turnSpeedDegrees * deltaTimeFrames);

            if (isGreaterEqualStep(this, this.paramFindPlayer.jumpStartStep))
                this.setNerve(WalkerStateFindPlayerNrv.FindJumpStart);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJumpStart) {
            if (isFirstStep(this))
                startAction(this.actor, 'JumpStart');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBckStopped(this.actor))
                this.setNerve(WalkerStateFindPlayerNrv.FindJump);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJump) {
            if (isFirstStep(this)) {
                vec3.scaleAndAdd(this.actor.velocity, this.actor.velocity, this.actor.gravityVector, -this.paramFindPlayer.jumpVelocity * deltaTimeFrames);
                startAction(this.actor, 'Jump');
            }

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBindedGround(this.actor) && isGreaterStep(this, 5))
                this.setNerve(WalkerStateFindPlayerNrv.FindJumpEnd);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJumpEnd) {
            if (isFirstStep(this))
                startAction(this.actor, 'Land');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBckStopped(this.actor))
                this.kill();
        }
    }
}

interface WalkerStateChaseParam {
    speed: number;
    turnSpeedDegrees: number;
    loseSightEndStep: number;
    forceEndStep: number;
    endStep: number;
}

enum WalkerStateChaseNrv { Start, End }
class WalkerStateChase extends ActorStateBaseInterface<WalkerStateChaseNrv> {
    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramChase: WalkerStateChaseParam) {
        super();

        this.initNerve(WalkerStateChaseNrv.Start);
    }

    public override appear(): void {
        super.appear();
        this.setNerve(WalkerStateChaseNrv.Start);
    }

    public isRunning() {
        return this.isNerve(WalkerStateChaseNrv.Start) && isBindedGround(this.actor);
    }

    private isInSightPlayer(sceneObjHolder: SceneObjHolder): boolean {
        return isInSightFanPlayer(sceneObjHolder, this.actor, this.front, this.param.sightFanRadius, this.param.sightFanAngleH, this.param.sightFanAngleV);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateChaseNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateChaseNrv.Start) {
            if (isFirstStep(this))
                startAction(this.actor, 'Run');

            const hasSight = this.isInSightPlayer(sceneObjHolder);
            if (hasSight) {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, scratchVec3a, this.paramChase.turnSpeedDegrees * deltaTimeFrames);
            }

            addVelocityMoveToDirection(this.actor, this.front, this.paramChase.speed * deltaTimeFrames);
            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isFallNextMoveActor(sceneObjHolder, this.actor, 150.0, 150.0, 150.0)) {
                vec3.zero(this.actor.velocity);
                this.setNerve(WalkerStateChaseNrv.End);
            } else {
                if (isGreaterStep(this, this.paramChase.forceEndStep) || (!hasSight && isGreaterStep(this, this.paramChase.loseSightEndStep)))
                    this.setNerve(WalkerStateChaseNrv.End);
            }
        } else if (currentNerve === WalkerStateChaseNrv.End) {
            if (isFirstStep(this))
                startAction(this.actor, 'Wait');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);
            if (isGreaterStep(this, this.paramChase.endStep))
                this.kill();
        }
    }
}

function updateActorState(sceneObjHolder: SceneObjHolder, actor: LiveActor, state: ActorStateBaseInterface, deltaTimeFrames: number): boolean {
    if (isFirstStep(actor))
        state.appear();

    const isDone = state.update(sceneObjHolder, deltaTimeFrames);
    if (isDone && !state.isDead)
        state.kill();

    return isDone;
}

function updateActorStateAndNextNerve<T extends number>(sceneObjHolder: SceneObjHolder, actor: LiveActor<T>, state: ActorStateBaseInterface, nextNerve: T, deltaTimeFrames: number): boolean {
    if (updateActorState(sceneObjHolder, actor, state, deltaTimeFrames)) {
        actor.setNerve(nextNerve);
        return true;
    } else {
        return false;
    }
}

function makeQuatAndFrontFromRotate(dstQuat: quat, dstFront: vec3, actor: Readonly<LiveActor>): void {
    quatFromEulerRadians(dstQuat, actor.rotation[0], actor.rotation[1], actor.rotation[2]);
    quatGetAxisZ(dstFront, dstQuat);
}

function blendQuatFromGroundAndFront(dst: quat, actor: Readonly<LiveActor>, front: ReadonlyVec3, speedUp: number, speedFront: number): void {
    if (isBindedGround(actor)) {
        vec3.copy(scratchVec3a, getGroundNormal(actor));
    } else {
        vec3.negate(scratchVec3a, actor.gravityVector);
    }

    blendQuatUpFront(dst, dst, scratchVec3a, front, speedUp, speedFront);
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

function calcVelocityAreaMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (!isOnGround(actor))
        return false;
    if (!isGroundCodeAreaMove(sceneObjHolder, actor.binder!.floorHitInfo))
        return false;

    // TODO(jstpierre): calcAreaMoveVelocity()
    return false;
}

function calcVelocityRailMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (!isOnGround(actor))
        return false;
    if (!isGroundCodeRailMove(sceneObjHolder, actor.binder!.floorHitInfo))
        return false;

    const floorActor = actor.binder!.floorHitInfo.hitSensor!.actor;
    calcNearestRailDirection(dst, floorActor, actor.translation);
    const speed = fallback(getRailArg(floorActor.railRider!, 'path_arg3'), -1);
    vec3.scale(dst, dst, speed);
    
    return true;
}

function calcVelocityAreaOrRailMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (calcVelocityAreaMoveOnGround(dst, sceneObjHolder, actor))
        return true;
    if (calcVelocityRailMoveOnGround(dst, sceneObjHolder, actor))
        return true;
    return false;
}

function isPressedRoofAndGround(actor: LiveActor): boolean {
    if (!isBindedGround(actor) || !isBindedRoof(actor))
        return false;

    const binder = actor.binder!;
    const groundSensor = binder.floorHitInfo.hitSensor!;
    const roofSensor = binder.ceilingHitInfo.hitSensor!;
    if (!isSensorPressObj(groundSensor) && !isSensorPressObj(roofSensor))
        return false;

    binder.ceilingHitInfo.calcForceMovePower(scratchVec3a, binder.ceilingHitInfo.strikeLoc);
    binder.floorHitInfo.calcForceMovePower(scratchVec3b, binder.floorHitInfo.strikeLoc);

    vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
    return vec3.dot(scratchVec3a, actor.gravityVector) >= 0.0;
}

const enum ItemGeneratorType { None, Coin, StarPiece }
class ItemGenerator {
    private type: ItemGeneratorType = ItemGeneratorType.None;
    private count = 0;

    public setTypeNone(): void {
        this.type = ItemGeneratorType.None;
    }

    public setTypeCoin(count: number): void {
        this.type = ItemGeneratorType.Coin;
        this.count = count;
    }

    public setTypeStarPeace(count: number): void {
        this.type = ItemGeneratorType.StarPiece;
        this.count = count;
    }

    public generate(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
        if (this.type === ItemGeneratorType.None || this.count === 0)
            return;

        vec3.negate(scratchVec3a, actor.gravityVector);
        if (this.type === ItemGeneratorType.Coin)
            appearCoinPopToDirection(sceneObjHolder, actor, actor.translation, scratchVec3a, this.count);
        else if (this.type === ItemGeneratorType.StarPiece)
            appearStarPieceToDirection(sceneObjHolder, actor, actor.translation, scratchVec3a, this.count, 10.0, 40.0);
    }
}

const enum KuriboNrv { AppearFromBox, Wander, FindPlayer, Chase, PressDown }
export class Kuribo extends LiveActor<KuriboNrv> {
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private manualGravity: boolean = false;
    private stateWander: WalkerStateWander;
    private stateFindPlayer: WalkerStateFindPlayer;
    private stateChase: WalkerStateChase;
    private itemGenerator = new ItemGenerator();
    public generateItem = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kuribo');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);

        if (infoIter !== null)
            this.manualGravity = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        if (this.manualGravity) {
            this.calcGravityFlag = false;
            quatGetAxisY(this.gravityVector, this.poseQuat);
        } else {
            this.calcGravityFlag = true;
        }

        const radius = 70.0 * this.scale[1];
        this.initBinder(radius, radius, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initSensor(sceneObjHolder);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        this.initState();
        this.initNerve(KuriboNrv.Wander);
        this.initAppearState(infoIter);

        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        turnQuatUpToGravity(this.poseQuat, this.poseQuat, this);
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.itemGenerator.setTypeStarPeace(3);
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        if (this.generateItem)
            this.itemGenerator.generate(sceneObjHolder, this);
        super.makeActorDead(sceneObjHolder);
    }

    private initState(): void {
        const param: WalkerStateParam = {
            gravitySpeed: 1.5,
            velDragAir: 0.99,
            velDragGround: 0.93,
            sightFanRadius: 1000.0,
            sightFanAngleH: 70.0,
            sightFanAngleV: 30.0,
        };

        this.stateWander = new WalkerStateWander(this, this.axisZ, param, {
            walkSpeed: 0.2,
            waitStep: 120,
            walkStep: 120,
            turnSpeedDegrees: 3.0,
            targetRadius: 20.0,
        });

        this.stateFindPlayer = new WalkerStateFindPlayer(this, this.axisZ, param, {
            turnSpeedDegrees: 5.0,
            jumpStartStep: 14,
            jumpVelocity: 20.0,
        });

        this.stateChase = new WalkerStateChase(this, this.axisZ, param, {
            speed: 0.4,
            turnSpeedDegrees: 2.0,
            loseSightEndStep: 130,
            forceEndStep: 300,
            endStep: 14,
        });
    }

    private initAppearState(infoIter: JMapInfoIter): void {
        const appearState = fallback(getJMapInfoArg1(infoIter), -1);
        if (appearState === 0) {
            // TODO(jstpierre): AppearFromBox
            // this.setNerve(KuriboNrv.AppearFromBox);
            quatGetAxisZ(this.axisZ, this.poseQuat);
        }
    }

    protected override calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (this.manualGravity)
            calcGravity(sceneObjHolder, this);

        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);

        if (calcVelocityAreaOrRailMoveOnGround(scratchVec3a, sceneObjHolder, this))
            vec3.add(this.velocity, this.velocity, scratchVec3a);

        this.tryDead(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KuriboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KuriboNrv.Wander) {
            updateActorState(sceneObjHolder, this, this.stateWander, deltaTimeFrames);

            if (this.tryFind(sceneObjHolder))
                return;
            this.tryNonActive(sceneObjHolder);
        } else if (currentNerve === KuriboNrv.FindPlayer) {
            updateActorStateAndNextNerve(sceneObjHolder, this, this.stateFindPlayer, KuriboNrv.Chase, deltaTimeFrames);
        } else if (currentNerve === KuriboNrv.Chase) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateChase, KuriboNrv.Wander, deltaTimeFrames))
                this.stateWander.setWanderCenter(this.translation);
        } else if (currentNerve === KuriboNrv.PressDown) {
            if (isFirstStep(this))
                vec3.zero(this.velocity);

            if (isGreaterStep(this, 180))
                this.makeActorDead(sceneObjHolder);
        }
    }

    private isEnableAttack(): boolean {
        return this.isNerve(KuriboNrv.Wander) || this.isNerve(KuriboNrv.FindPlayer) || this.isNerve(KuriboNrv.Chase);
    }

    private isEnablePushMove(): boolean {
        // FlatDown, HipDropDown, PressDown, BlowDown
        return true;
    }

    private isEnableDead(): boolean {
        // Stagger, BindStarPointer, NonActive, AttackSuccess
        return this.isNerve(KuriboNrv.Wander) || this.isNerve(KuriboNrv.FindPlayer) || this.isNerve(KuriboNrv.Chase);
    }

    private isUpsideDown(): boolean {
        // if (this.isNerve(KuriboNrv.Stagger))
        //     return this.stateStagger.isUpsideDown();
        return false;
    }

    private requestAttackSuccess(sceneObjHolder: SceneObjHolder): void {
        // should never happen in practice
        throw "whoops";
    }

    private requestDead(): boolean {
        // NonActive, FlatDown, HipDropDown, PressDown, BlowDown
        if (this.isNerve(KuriboNrv.PressDown))
            return false;

        deleteEffectAll(this);
        clearHitSensors(this);
        invalidateHitSensors(this);
        return true;
    }

    private requestPressDown(sceneObjHolder: SceneObjHolder): boolean {
        if (!this.requestDead())
            return false;

        startAction(this, this.isUpsideDown() ? 'HipDropDownReverse' : 'HipDropDown');
        this.setNerve(KuriboNrv.PressDown);
        vec3.zero(this.velocity);
        this.calcBinderFlag = false;
        this.itemGenerator.setTypeStarPeace(3);
        return true;
    }

    private tryDead(sceneObjHolder: SceneObjHolder): boolean {
        if (!this.isEnableDead())
            return false;

        if (isInDeath(sceneObjHolder, this.translation) || isBindedGroundDamageFire(sceneObjHolder, this) || isInWater(sceneObjHolder, this.translation)) {
            this.itemGenerator.setTypeNone();
            this.makeActorDead(sceneObjHolder);
            return true;
        }

        if (isPressedRoofAndGround(this) && this.requestPressDown(sceneObjHolder))
            return true;

        return false;
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (!thisSensor.isType(HitSensorType.Kuribo)) {
            if (isSensorEnemy(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(otherSensor)) && this.isEnablePushMove())
                sendMsgPushAndKillVelocityToTarget(sceneObjHolder, this, otherSensor, thisSensor);
        }

        if (this.isEnableAttack()) {
            if (isSensorPlayer(otherSensor) && thisSensor.isType(HitSensorType.EnemyAttack)) {
                if (/* isPlayerHipDropFalling(sceneObjHolder) || */ !sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor))
                    sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
                else
                    this.requestAttackSuccess(sceneObjHolder);
            }
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor, thisSensor: HitSensor): boolean {
        if (thisSensor.isType(HitSensorType.EnemyAttack))
            return false;

        if (isSensorEnemy(otherSensor) || isSensorRide(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(thisSensor)) || this.isEnablePushMove())
            addVelocityFromPush(this, 1.5, otherSensor, thisSensor);

        if (messageType === MessageType.InhaleBlackHole) {
            this.itemGenerator.setTypeNone();
            this.makeActorDead(sceneObjHolder);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private initSensor(sceneObjHolder: SceneObjHolder): void {
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 75.0 * this.scale[1], 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.Kuribo, 8, scratchVec3a[1], scratchVec3a);
        addHitSensor(sceneObjHolder, this, 'attack', HitSensorType.EnemyAttack, 8, 45.8 * this.scale[1], scratchVec3a);
    }

    private tryFind(sceneObjHolder: SceneObjHolder): boolean {
        if (this.stateFindPlayer.isInSightPlayer(sceneObjHolder)) {
            this.setNerve(KuriboNrv.FindPlayer);
            return true;
        } else {
            return false;
        }
    }

    private tryNonActive(sceneObjHolder: SceneObjHolder): boolean {
        // TODO(jstpierre)
        return false;
    }
}

const enum KuriboMiniNrv { Wander, FindPlayer, Chase }
export class KuriboMini extends LiveActor<KuriboMiniNrv> {
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private stateWander: WalkerStateWander;
    private stateFindPlayer: WalkerStateFindPlayer;
    private stateChase: WalkerStateChase;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'KuriboMini');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'KuriboMini');
        connectToSceneEnemy(sceneObjHolder, this);

        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);
        this.calcGravityFlag = true;
        initLightCtrl(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);

        // ItemGenerator
        // AnimScaleController
        // initSound
        this.initEffectKeeper(sceneObjHolder, null);
        // initStarPointerTarget
        initShadowVolumeSphere(sceneObjHolder, this, 40.0);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 60.0, 0.0);
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 60.0, scratchVec3a);
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 40.0, scratchVec3a);

        this.initBinder(60.0, 60.0, 0);
        this.initNerve(KuriboMiniNrv.Wander);
        this.initState();

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    private initState(): void {
        const param: WalkerStateParam = {
            gravitySpeed: 1.5,
            velDragAir: 0.99,
            velDragGround: 0.93,
            sightFanRadius: 1000.0,
            sightFanAngleH: 70.0,
            sightFanAngleV: 30.0,
        };

        this.stateWander = new WalkerStateWander(this, this.axisZ, param, {
            walkSpeed: 0.1,
            waitStep: 120,
            walkStep: 120,
            turnSpeedDegrees: 3.0,
            targetRadius: 20.0,
        });

        this.stateFindPlayer = new WalkerStateFindPlayer(this, this.axisZ, param, {
            turnSpeedDegrees: 5.0,
            jumpStartStep: 14,
            jumpVelocity: 10.0,
        });

        this.stateChase = new WalkerStateChase(this, this.axisZ, param, {
            speed: 0.2,
            turnSpeedDegrees: 2.0,
            loseSightEndStep: 130,
            forceEndStep: 300,
            endStep: 14,
        });
    }


    protected override calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KuriboMiniNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KuriboMiniNrv.Wander) {
            updateActorState(sceneObjHolder, this, this.stateWander, deltaTimeFrames);

            if (this.tryFind(sceneObjHolder))
                return;
            if (this.tryDeadMap(sceneObjHolder))
                return;
        } else if (currentNerve === KuriboMiniNrv.FindPlayer) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateFindPlayer, KuriboMiniNrv.Chase, deltaTimeFrames))
                return;
            if (this.tryDeadMap(sceneObjHolder))
                return;
        } else if (currentNerve === KuriboMiniNrv.Chase) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateChase, KuriboMiniNrv.Wander, deltaTimeFrames))
                this.stateWander.setWanderCenter(this.translation);
            if (this.tryDeadMap(sceneObjHolder))
                return;
        }
    }

    private tryFind(sceneObjHolder: SceneObjHolder): boolean {
        if (this.stateFindPlayer.isInSightPlayer(sceneObjHolder)) {
            this.setNerve(KuriboMiniNrv.FindPlayer);
            return true;
        } else {
            return false;
        }
    }

    private tryDeadMap(sceneObjHolder: SceneObjHolder): boolean {
        if (isInDeath(sceneObjHolder, this.translation) || isBindedGroundDamageFire(sceneObjHolder, this) || isInWater(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return true;
        } else {
            return false;
        }
    }

    private isEnableAttack(): boolean {
        return this.isNerve(KuriboMiniNrv.Wander) || this.isNerve(KuriboMiniNrv.FindPlayer) || this.isNerve(KuriboMiniNrv.Chase);
    }

    private isEnablePushMove(): boolean {
        // FlatDown, HipDropDown, PressDown, BlowDown
        return true;
    }

    private requestAttackSuccess(sceneObjHolder: SceneObjHolder): void {
        // should never happen in practice
        throw "whoops";
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (!thisSensor.isType(HitSensorType.Kuribo)) {
            if (isSensorEnemy(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(otherSensor)) && this.isEnablePushMove())
                sendMsgPushAndKillVelocityToTarget(sceneObjHolder, this, otherSensor, thisSensor);
        }

        if (this.isEnableAttack()) {
            if (isSensorPlayer(otherSensor) && thisSensor.isType(HitSensorType.EnemyAttack)) {
                if (/* isPlayerHipDropFalling(sceneObjHolder) || */ !sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor))
                    sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
                else
                    this.requestAttackSuccess(sceneObjHolder);
            }
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor, thisSensor: HitSensor): boolean {
        if (thisSensor.isType(HitSensorType.EnemyAttack))
            return false;

        if (isSensorEnemy(otherSensor) || isSensorRide(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(thisSensor)) || this.isEnablePushMove())
            addVelocityFromPush(this, 1.5, otherSensor, thisSensor);

        if (messageType === MessageType.InhaleBlackHole) {
            this.makeActorDead(sceneObjHolder);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
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

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
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

    public override calcAndSetBaseMtx(): void {
        mat4.rotateZ(this.modelInstance!.modelMatrix, this.baseMtx, this.rotation[2] * 0.02);
    }

    private setBckRate(rate: number, includeParts: boolean): void {
        if (this.type === HomingKillerType.MagnumKiller)
            return;

        setBckRate(this, rate);

        if (includeParts && this.type === HomingKillerType.Torpedo)
            setBckRate(this.torpedoPropellerParts!, rate);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerNrv, deltaTimeFrames: number): void {
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
                            const groundNormal = getGroundNormal(this);
                            if (vec3.dot(this.gravityVector, groundNormal) < -0.75) {
                                emitEffect(sceneObjHolder, this, 'SandColumn');

                                let effectPos: ReadonlyVec3;
                                if (isShadowProjected(this, null))
                                    effectPos = getShadowProjectionPos(this, null);
                                else
                                    effectPos = this.translation;

                                vec3.negate(scratchVec3a, this.gravityVector);
                                if (isSameDirection(this.axisZ, scratchVec3a, 0.01))
                                    makeMtxUpNoSupportPos(this.effectHostMtx, scratchVec3a, effectPos);
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

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

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

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
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
        let speed: number;

        if (this.type === HomingKillerType.Torpedo) {
            // noclip modification: Increase Torpedo speed by 3x to make it faster to hit the weight in Buoy Base.
            speed = 5.0 * 3.0;
        } else if (this.type === HomingKillerType.HomingKiller) {
            speed = 12.0 * 2;
        } else if (this.type === HomingKillerType.MagnumKiller) {
            speed = 12.0;
        } else {
            throw "whoops";
        }

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
        vec3.copy(scratchVec3a, Vec3Zero);
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

        const playerHitRadius = (this.type === HomingKillerType.Torpedo ? 75.0 : 200.0);
        if (this.tryBindedBreak(sceneObjHolder) || this.isWaterBreak(sceneObjHolder) || !isNearPlayer(sceneObjHolder, this, this.chaseEndDistance) ||
            // noclip modification: we don't have a hitsensor for the player (camera)
            isNearPlayer(sceneObjHolder, this, playerHitRadius)
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

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (!this.isNerve(HomingKillerNrv.Appear) && !this.isNerve(HomingKillerNrv.Break)) {
                if (this.type !== HomingKillerType.MagnumKiller)
                    this.setNerve(HomingKillerNrv.Break);
                return true;
            }
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
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

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(HomingKillerLauncherNrv.AppearKiller);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerLauncherNrv, deltaTimeFrames: number): void {
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

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
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

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('DinoPackun');
        sceneObjHolder.modelCache.requestObjectData('DinoPackunTailBall');
    }
}

export function turnVecToVecRadian(dst: vec3, src: ReadonlyVec3, target: ReadonlyVec3, speed: number, up: ReadonlyVec3): number {
    const dot = Math.min(vec3.dot(src, target), 1.0);

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

class SpinHitController {
    private stopScene: boolean = false;

    constructor(private emitItemStep: number, private killStep: number, unkStopScene: number, private gravitySpeed: number, private reactSpeed: number, private reactJumpSpeed: number, private itemCount: number, private itemIsCoin: boolean) {
    }

    private emitItem(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
        if (this.itemCount === 0)
            return;

        if (this.itemIsCoin) {
            appearCoinPop(sceneObjHolder, actor, actor.translation, this.itemCount);
        } else {
            appearStarPiece(sceneObjHolder, actor, actor.translation, this.itemCount, 10.0, 40.0, false);
        }

        this.itemCount = 0;
    }

    public execute(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
        if (isFirstStep(actor)) {
            // invalidateClipping
            if (this.stopScene) {
                // stopSceneForDefaultHit
            }
        }

        vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, this.gravitySpeed);
        if (isGreaterEqualStep(actor, this.emitItemStep))
            this.emitItem(sceneObjHolder, actor);

        if (isGreaterStep(actor, this.killStep)) {
            // validateClipping
            actor.makeActorDead(sceneObjHolder);
            if (isLessStep(actor, this.emitItemStep))
                this.emitItem(sceneObjHolder, actor);
            return true;
        } else {
            // TODO(jstpierre): Check isBinded / isGreaterStep(1) ?
            return false;
        }
    }

    public start(targetActor: LiveActor, attackerPos: ReadonlyVec3, targetPos: ReadonlyVec3): void {
        vec3.sub(scratchVec3a, targetPos, attackerPos);
        vecKillElement(scratchVec3a, scratchVec3a, targetActor.gravityVector);
        vec3.normalize(scratchVec3a, scratchVec3a);
        vec3.scale(scratchVec3a, scratchVec3a, this.reactSpeed);
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, targetActor.gravityVector, -this.reactJumpSpeed);
        vec3.copy(targetActor.velocity, scratchVec3a);
        this.stopScene = true;
    }

    public startWithoutStopScene(targetActor: LiveActor, attackerPos: ReadonlyVec3, targetPos: ReadonlyVec3): void {
        this.start(targetActor, attackerPos, targetPos);
        this.stopScene = false;
    }
}

const enum TakoboNrv { Wait, Move, Attack, HitPunch, Press }
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
    private spinHitController: SpinHitController;

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

        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);
        // initSound
        this.initBinder(80.0 * this.scale[1], 60.0 * this.scale[1], 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSensor()
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 70.0 * this.scale[1], 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.Takobo, 32, scratchVec3a[1], scratchVec3a);
        // addHitSensorAtJointEnemyAttack

        initShadowVolumeSphere(sceneObjHolder, this, 70.0 * this.scale[1]);
        onCalcShadow(this);

        this.initNerve(TakoboNrv.Wait);

        this.spinHitController = new SpinHitController(22, 21, 3, 1.5, 20.0, 35.0, 3, false);

        initLightCtrl(sceneObjHolder, this);
        this.makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        calcGravity(sceneObjHolder, this);
        this.calcBinderFlag = false;
    }

    public override calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.frontVec);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TakoboNrv, deltaTimeFrames: number): void {
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
                vec3.scale(scratchVec3a, this.moveDir, this.moveDistance);
                vec3.sub(scratchVec3a, this.initPos, scratchVec3a);
                vec3.sub(scratchVec3a, this.translation, scratchVec3a);

                if (this.moveIsGoingBack) {
                    this.moveDistanceStart = -this.moveDistance;
                    this.moveDistanceEnd = -this.moveDistance + vec3.dot(scratchVec3a, this.moveDir);
                } else {
                    this.moveDistanceEnd = this.moveDistance;
                    this.moveDistanceStart = -this.moveDistance +  vec3.dot(scratchVec3a, this.moveDir);
                }
                this.moveTimeStep = (this.moveDistanceEnd - this.moveDistanceStart) / this.moveTime;
                this.moveTimeStep = (this.moveTimeStep * 1.3) | 0;
            }

            let moveT = calcNerveRate(this, this.moveTimeStep);
            if (this.moveIsGoingBack)
                moveT = 1.0 - moveT;

            const distance = getEaseInOutValue(moveT, this.moveDistanceStart, this.moveDistanceEnd);
            vec3.scaleAndAdd(scratchVec3a, this.initPos, this.moveDir, distance);
            vec3.sub(this.velocity, scratchVec3a, this.translation);

            if (isGreaterEqualStep(this, this.moveTimeStep)) {
                this.moveIsGoingBack = !this.moveIsGoingBack;
                this.setNerve(TakoboNrv.Move);
            } else {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                vec3.sub(scratchVec3a, scratchVec3a, this.translation);
                const distance = vec3.length(scratchVec3a);
                vecKillElement(scratchVec3a, scratchVec3a, this.gravityVector);
                vec3.normalize(scratchVec3a, scratchVec3a);

                if (distance <= 250.0) {
                    const distance = turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3a, 0.05, this.gravityVector);
                    if (distance < 0.1) {
                        this.setNerve(TakoboNrv.Attack);
                    }
                } else if (distance < 800.0) {
                    turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3a, 0.05, this.gravityVector);
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
        } else if (currentNerve === TakoboNrv.HitPunch) {
            if (isFirstStep(this)) {
                startAction(this, 'HitPunch');
                // startSound
                // startBlowHitSound
                // clearHitSensors(this);
                invalidateHitSensors(this);
                this.calcBinderFlag = true;
                onCalcShadow(this);
            }

            this.spinHitController.execute(sceneObjHolder, this);
        }
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'TakoboDeath');
        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (!thisSensor!.isType(HitSensorType.Takobo))
                return false;

            if (!this.isNerve(TakoboNrv.HitPunch) && !this.isNerve(TakoboNrv.Press)) {
                if (messageType === MessageType.EnemyAttackExplosion) {
                    this.spinHitController.startWithoutStopScene(this, otherSensor!.center, thisSensor!.center);
                    this.setNerve(TakoboNrv.HitPunch);
                    return true;
                }
            }
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }
}

function calcNerveEaseInOutRate(actor: LiveActor, duration: number): number {
    const t = duration < 1 ? 1.0 : (actor.getNerveStep() / duration);
    return getEaseInOutValue(t);
}

const enum EyeBeamerNrv { Wait, Turn, GotoPatrol, Patrol }
export class EyeBeamer extends LiveActor<EyeBeamerNrv> {
    private beamModel: ModelObj;
    private beamBloomModel: ModelObj;
    private partsModelMtx = mat4.create();
    private waterSurfaceMtx = mat4.create();
    private isInMercatorCube = false;
    private poseQuat = quat.create();
    private initPoseQuat = quat.create();
    private railMover: MapPartsRailMover;
    private initPos = vec3.create();
    private position = vec3.create();
    private railStartPos = vec3.create();
    private targetPos = vec3.create();

    private beamLength: number;
    private beamSurfaceDistance: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'EyeBeamer');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.isInMercatorCube = isInAreaObj(sceneObjHolder, 'MercatorCube', this.translation);

        // initModel()
        this.initModelManagerWithAnm(sceneObjHolder, 'EyeBeamer');
        // VolumeModelDrawer EyeBeamerBeamVolume
        this.beamBloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'EyeBeamerBeamBloom', 'EyeBeamerBeamBloom', this.partsModelMtx, DrawBufferType.BloomModel, -2, -2);
        this.beamModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'EyeBeamerBeam', 'EyeBeamerBeam', this.partsModelMtx, DrawBufferType.IndirectMapObj, -2, -2);
        startBtk(this.beamModel, 'EyeBeamerBeam');
        connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.MapObjStrongLight, DrawType.VolumeModel);

        quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
        quat.copy(this.initPoseQuat, this.poseQuat);

        vec3.copy(this.position, this.translation);
        this.beamLength = fallback(getJMapInfoArg0(infoIter), 2000.0);
        this.beamSurfaceDistance = fallback(getJMapInfoArg1(infoIter), -1.0);

        this.initHitSensor();
        const bodySensor = addHitSensorMapObj(sceneObjHolder, this, 'body', 8, 0.0, Vec3Zero);

        vec3.set(scratchVec3a, 0.0, -0.5 * this.beamLength, 0.0);
        addHitSensorEye(sceneObjHolder, this, 'beam', 8, 140.0 + 0.5 * this.beamLength, scratchVec3a);

        initCollisionParts(sceneObjHolder, this, 'EyeBeamer', bodySensor);

        // initRailMoveFunction()
        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
            this.railMover.start();
            moveCoordToStartPos(this);
        } else {
            assert(false);
        }

        vec3.copy(this.initPos, this.position);
        calcRailStartPos(this.railStartPos, this);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'BeamSurface', this.waterSurfaceMtx);

        // initStartNerve()
        const initAction = fallback(getJMapInfoArg2(infoIter), -1);
        if (initAction === 0)
            this.initNerve(EyeBeamerNrv.Patrol);
        else
            this.initNerve(EyeBeamerNrv.Wait);

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffA(sceneObjHolder, this, this.requestStartPatrol.bind(this), null);

        startBck(this, 'EyeBeamer');
        this.makeActorAppeared(sceneObjHolder);
    }

    public override calcAnim(sceneObjHolder: SceneObjHolder): void {
        super.calcAnim(sceneObjHolder);

        const beamJointMtx = getJointMtxByName(this, 'Beam')!;
        vec3.set(scratchVec3a, 1.0, this.beamLength / 2000.0, 1.0);
        mat4.scale(this.partsModelMtx, beamJointMtx, scratchVec3a);
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        // Nothing, lol
    }

    private updatePoseAndTrans(sceneObjHolder: SceneObjHolder): void {
        const dst = this.modelInstance!.modelMatrix;
        mat4.fromQuat(dst, this.poseQuat);

        if (false && this.isInMercatorCube) {
            // TODO
        } else {
            vec3.copy(this.translation, this.position);
        }

        setMatrixTranslation(dst, this.translation);
        vec3.copy(this.modelInstance!.baseScale, this.scale);
    }

    private updateWaterSurfaceMtx(sceneObjHolder: SceneObjHolder) :void {
        if (this.beamSurfaceDistance < 0.0)
            return;

        mat4.fromQuat(this.waterSurfaceMtx, this.poseQuat);
        getMatrixAxisY(scratchVec3a, this.waterSurfaceMtx);
        vec3.sub(scratchVec3b, this.position, this.railStartPos);
        vec3.scaleAndAdd(scratchVec3a, this.position, scratchVec3a, -vec3.dot(scratchVec3a, scratchVec3b) * this.beamSurfaceDistance);

        if (false && this.isInMercatorCube) {
            // TODO
        } else {
            setMatrixTranslation(this.waterSurfaceMtx, scratchVec3a);
        }
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        this.updatePoseAndTrans(sceneObjHolder);
        this.updateWaterSurfaceMtx(sceneObjHolder);
    }

    public override draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);
        // TODO(jstpierre): VolumeDrawer
    }

    private requestStartPatrol(sceneObjHolder: SceneObjHolder): void {
        if (this.isNerve(EyeBeamerNrv.Wait))
            this.setNerve(EyeBeamerNrv.Turn);
    }

    private tryGotoPatrol(sceneObjHolder: SceneObjHolder): void {
        if (isGreaterStep(this, 300))
            this.setNerve(EyeBeamerNrv.GotoPatrol);
    }

    private tryPatrol(sceneObjHolder: SceneObjHolder): void {
        if (isGreaterStep(this, 500))
            this.setNerve(EyeBeamerNrv.Patrol);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: EyeBeamerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === EyeBeamerNrv.Wait) {
            // Nothing
        } else if (currentNerve === EyeBeamerNrv.Turn) {
            const t = calcNerveEaseInOutRate(this, 300.0);
            quatGetAxisX(scratchVec3a, this.initPoseQuat);
            quat.setAxisAngle(scratchQuat, scratchVec3a, t * MathConstants.TAU / 2);
            quat.mul(this.poseQuat, scratchQuat, this.initPoseQuat);
            this.tryGotoPatrol(sceneObjHolder);
        } else if (currentNerve === EyeBeamerNrv.GotoPatrol) {
            vec3.lerp(this.position, this.initPos, this.railStartPos, calcNerveEaseInOutRate(this, 500));
            this.tryPatrol(sceneObjHolder);
        } else if (currentNerve === EyeBeamerNrv.Patrol) {
            if (isFirstStep(this)) {
                quatGetAxisX(scratchVec3a, this.initPoseQuat);
                quat.setAxisAngle(scratchQuat, scratchVec3a, MathConstants.TAU / 2);
                quat.mul(this.poseQuat, scratchQuat, this.initPoseQuat);

                if (this.beamSurfaceDistance > 0)
                    emitEffect(sceneObjHolder, this, 'BeamSurface');
            }

            calcUpVec(scratchVec3a, this);
            vec3.scaleAndAdd(this.targetPos, this.translation, scratchVec3a, this.beamLength * 0.5);
            this.railMover.movement(sceneObjHolder);
            vec3.copy(this.position, this.railMover.translation);
        }
    }

    private isOnBeam(): boolean {
        return this.isNerve(EyeBeamerNrv.Wait) || this.isNerve(EyeBeamerNrv.Patrol);
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (this.isOnBeam() && isSensorPlayer(otherSensor)) {
            getPlayerPos(scratchVec3a, sceneObjHolder);
            // if (this.isInBeamRange(scratchVec3a))
            //     sendMsgEnemyAttackHeatBeam(sceneObjHolder, otherSensor, thisSensor);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('EyeBeamerBeam');
        sceneObjHolder.modelCache.requestObjectData('EyeBeamerBeamBloom');
    }
}

function isNearAngleRadianHV(delta: ReadonlyVec3, front: ReadonlyVec3, h: ReadonlyVec3, angleH: number, angleV: number): boolean {
    angleV = Math.min(angleV, MathConstants.TAU / 4);

    vec3.normalize(scratchVec3a, delta);
    // Vertical cone check
    if (Math.abs(vec3.dot(scratchVec3a, front)) < Math.sin(angleV))
        return false;
    vecKillElement(scratchVec3b, scratchVec3a, h);
    // Horizontal cone check
    if (vec3.dot(scratchVec3b, front) < Math.cos(angleH))
        return false;
    return true;
}

function isNearAngleDegreeHV(delta: ReadonlyVec3, front: ReadonlyVec3, h: ReadonlyVec3, angleH: number, angleV: number): boolean {
    return isNearAngleRadianHV(delta, front, h, angleH * MathConstants.DEG_TO_RAD, angleV * MathConstants.DEG_TO_RAD);
}

function isFaceToPlayerDegreeHV(sceneObjHolder: SceneObjHolder, actor: LiveActor, front: ReadonlyVec3, angleH: number, angleV: number): boolean {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    vec3.sub(scratchVec3a, scratchVec3a, actor.translation);
    return isNearAngleDegreeHV(scratchVec3a, front, actor.gravityVector, angleH, angleV);
}

function isInSightFanPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor, front: ReadonlyVec3, radius: number, angleH: number, angleV: number): boolean {
    // drawWorldSpaceFan(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, actor.translation, radius, front, angleH * MathConstants.DEG_TO_RAD, actor.gravityVector);
    return isNearPlayer(sceneObjHolder, actor, radius) && isFaceToPlayerDegreeHV(sceneObjHolder, actor, front, angleH, angleV);
}

function applyVelocityDampAndGravity(actor: LiveActor, gravitySpeed: number, groundDamp: number, airDamp: number, airUpDamp: number, v4: number = 1.0): void {
    if (!isBindedGround(actor))
        vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, gravitySpeed);

    const actorOnGround = isOnGround(actor);

    const dot = vecKillElement(scratchVec3a, actor.velocity, actor.gravityVector);
    if (actorOnGround)
        vec3.scale(scratchVec3a, scratchVec3a, groundDamp);
    else
        vec3.scale(scratchVec3a, scratchVec3a, airDamp);

    vec3.scale(scratchVec3b, actor.gravityVector, dot);
    if (dot < 0.0)
        vec3.scale(scratchVec3b, scratchVec3b, airUpDamp);

    vec3.add(actor.velocity, scratchVec3a, scratchVec3b);

    if (actorOnGround) {
        const groundNormal = getGroundNormal(actor);
        vecKillElement(scratchVec3a, actor.velocity, groundNormal);
        if (vec3.squaredLength(scratchVec3a) < v4 ** 2.0)
            vec3.scale(actor.velocity, groundNormal, vec3.dot(groundNormal, actor.velocity));
    }
}

const enum MoguStoneNrv { Taken, Fall, Throw }
class MoguStone extends ModelObj<MoguStoneNrv> {
    private poseQuat = quat.create();
    private throwPlanar = false;
    private throwDirection = vec3.create();
    private throwSpeed = 0.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'MoguStone', 'MoguStone', null, -2, -2, -2);
        this.initBinder(40.0 * this.scale[1], 0.0, 0);
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 32, 80.0, Vec3Zero);
        this.initNerve(MoguStoneNrv.Taken);
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 50.0 * this.scale[1]);
        this.makeActorDead(sceneObjHolder);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        if (this.spine !== null)
            this.setNerve(MoguStoneNrv.Taken);
    }

    public emit(sceneObjHolder: SceneObjHolder, throwPlanar: boolean, pos: ReadonlyVec3, front: ReadonlyVec3, throwSpeed: number): void {
        this.throwSpeed = throwSpeed;

        vec3.copy(this.translation, pos);
        vec3.zero(this.velocity);
        calcGravity(sceneObjHolder, this);

        vec3.sub(this.throwDirection, front, pos);

        this.throwPlanar = throwPlanar;
        if (this.throwPlanar) {
            this.calcGravityFlag = true;
            vecKillElement(this.throwDirection, this.throwDirection, this.gravityVector);
        } else {
            this.calcGravityFlag = false;
        }
        vec3.normalize(this.throwDirection, this.throwDirection);

        this.setNerve(MoguStoneNrv.Throw);
    }

    protected doBehavior(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        if (isFirstStep(this)) {
            // reset quat
        }

        if (this.throwPlanar) {
            vecKillElement(this.throwDirection, this.throwDirection, this.gravityVector);
            vec3.normalize(this.throwDirection, this.throwDirection);
        }

        vec3.scale(this.velocity, this.throwDirection, this.throwSpeed * deltaTimeFrames);
        vec3.negate(scratchVec3a, this.gravityVector);
        makeQuatUpFront(this.poseQuat, scratchVec3a, this.throwDirection);

        if (isGreaterStep(this, 100)) {
            emitEffect(sceneObjHolder, this, 'Break');
            this.makeActorDead(sceneObjHolder);
        }
    }

    public isTaken(): boolean {
        return this.isNerve(MoguStoneNrv.Taken);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MoguStoneNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MoguStoneNrv.Throw) {
            this.doBehavior(sceneObjHolder, deltaTimeFrames);
            // rot quat

            if (isBinded(this)) {
                emitEffect(sceneObjHolder, this, 'Break');
                this.makeActorDead(sceneObjHolder);
                return;
            }

            if (isGreaterStep(this, 100))
                this.setNerve(MoguStoneNrv.Fall);
        } else if (currentNerve === MoguStoneNrv.Fall) {
            applyVelocityDampAndGravity(this, 2.0 * deltaTimeFrames, 0.8, 0.98, 0.98);

            if (isBinded(this)) {
                emitEffect(sceneObjHolder, this, 'Break');
                this.makeActorDead(sceneObjHolder);
                return;
            }
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('MoguStone');
    }
}

const enum MoguNrv { Search, Turn, Throw, Hide, HideWait, Appear }
export class Mogu extends LiveActor<MoguNrv> {
    private axisY = vec3.clone(Vec3UnitY);
    private axisZ = vec3.clone(Vec3UnitZ);
    private fixedPosition: FixedPosition;
    private hole: ModelObj;
    private stone: MoguStone;
    private isCannonFleetGalaxy: boolean;
    private throwPlanar: boolean;
    private hasEmittedStone: boolean = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Mogu');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.throwPlanar = !getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        this.initModelManagerWithAnm(sceneObjHolder, 'Mogu');
        calcUpVec(this.axisY, this);
        connectToSceneEnemy(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 1);
        declareCoin(sceneObjHolder, this, 1);

        this.initBinder(160.0 * this.scale[1], 160.0 * this.scale[1], 0);
        this.initHitSensor();
        vec3.set(scratchVec3a, -55.0, 0.0, 13.0);
        vec3.scale(scratchVec3a, scratchVec3a, this.scale[1]);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Head', 32, 150.0 * this.scale[1], scratchVec3a);
        this.initEffectKeeper(sceneObjHolder, null);
        // initStarPointerTarget
        // initSound
        this.initNerve(MoguNrv.Search);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0 * this.scale[1]);
        initLightCtrl(sceneObjHolder, this);
        // AnimScaleController
        this.makeActorAppeared(sceneObjHolder);
        vec3.set(scratchVec3a, 67.38, 0.0, 0.0);
        this.fixedPosition = new FixedPosition(getJointMtxByName(this, 'ArmR2')!, scratchVec3a, Vec3Zero);

        this.hole = new ModelObj(zoneAndLayer, sceneObjHolder, 'MoguHole', 'MoguHole', null, -2, -2, -2);
        vec3.copy(this.hole.translation, this.translation);
        vec3.copy(this.hole.rotation, this.rotation);

        this.stone = new MoguStone(zoneAndLayer, sceneObjHolder);

        this.isCannonFleetGalaxy = isEqualStageName(sceneObjHolder, 'CannonFleetGalaxy');
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxUpFrontPos(this.modelInstance!.modelMatrix, this.axisY, this.axisZ, this.translation);

        if (this.isNerve(MoguNrv.Throw) && isLessStep(this, 47)) {
            this.fixedPosition.calc();
            getMatrixTranslation(this.stone.translation, this.fixedPosition.transformMatrix);
        }
    }

    private isPlayerExistUp(sceneObjHolder: SceneObjHolder): boolean {
        // getPlayerCenterPos
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        if (vec3.dot(this.axisY, scratchVec3a) >= 0.0) {
            // getPlayerGravity
            getCamYdir(scratchVec3b, sceneObjHolder.viewerInput.camera);
            vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
            return vec3.squaredLength(scratchVec3a) <= (400.0 ** 2);
        } else {
            return false;
        }
    }

    private tearDownThrow(sceneObjHolder: SceneObjHolder): void {
        if (this.stone.isTaken())
            this.stone.makeActorDead(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MoguNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MoguNrv.Search || currentNerve === MoguNrv.Turn) {
            if (isFirstStep(this)) {
                const action = currentNerve === MoguNrv.Turn ? 'Turn' : 'Wait';
                startAction(this, action);
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (false /* isNearPlayerHipDrop */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (currentNerve === MoguNrv.Turn) {
                calcVecToPlayerH(scratchVec3a, sceneObjHolder, this);
                turnVecToVecRadian(this.axisZ, this.axisZ, scratchVec3a, 0.03 * deltaTimeFrames, this.axisY);
            }

            const turnDistanceThresh = this.isCannonFleetGalaxy ? 1500.0 : 900.0;

            const isActive = !isValidSwitchA(this) || this.stageSwitchCtrl!.isOnSwitchA(sceneObjHolder);
            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder) || distance >= 2000.0) {
                this.setNerve(MoguNrv.Hide);
            } else if (currentNerve === MoguNrv.Turn && distance >= turnDistanceThresh) {
                this.setNerve(MoguNrv.Search);
            } else if (isActive && currentNerve === MoguNrv.Search && distance <= turnDistanceThresh) {
                this.setNerve(MoguNrv.Turn);
            } else if (isActive && isInSightFanPlayer(sceneObjHolder, this, this.axisZ, turnDistanceThresh, 10.0, 90.0)) {
                if (isGreaterStep(this, 45) && isDead(this.stone))
                    this.setNerve(MoguNrv.Throw);
            }
        } else if (currentNerve === MoguNrv.Hide) {
            if (isFirstStep(this)) {
                startAction(this, 'Hide');
                startAction(this.hole, 'Hide');

                // player velocity
                if (calcDistanceToPlayer(sceneObjHolder, this) < 200.0)
                    setBckRate(this, 1.5);
            }

            if (isActionEnd(this))
                this.setNerve(MoguNrv.HideWait);
        } else if (currentNerve === MoguNrv.HideWait) {
            if (isGreaterStep(this, 120)) {
                const distance = calcDistanceToPlayer(sceneObjHolder, this);
                if (distance > 400.0 && distance < 2000.0) {
                    getPlayerPos(scratchVec3a, sceneObjHolder);
                    vec3.sub(scratchVec3a, scratchVec3a, this.translation);
                    vec3.normalize(scratchVec3a, scratchVec3a);
                    if (vec3.dot(scratchVec3a, this.gravityVector) >= -0.75) {
                        this.setNerve(MoguNrv.Appear);
                    }
                }
            }
        } else if (currentNerve === MoguNrv.Appear) {
            if (isFirstStep(this)) {
                startAction(this, 'Appear');
                startAction(this.hole, 'Open');
                calcVecToPlayerH(scratchVec3a, sceneObjHolder, this);
                turnVecToVecRadian(this.axisZ, this.axisZ, scratchVec3a, MathConstants.TAU / 2, this.axisY);
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (!isGreaterStep(this, 14) && false /* isNearPlayerHipDrop */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder)) {
                this.setNerve(MoguNrv.Hide);
            } else if (isActionEnd(this)) {
                this.setNerve(MoguNrv.Search);
            }
        } else if (currentNerve === MoguNrv.Throw) {
            if (isFirstStep(this)) {
                startAction(this, 'Throw');
                this.stone.makeActorAppeared(sceneObjHolder);
                startAction(this.stone, 'Rotate');
                this.hasEmittedStone = false;
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                this.tearDownThrow(sceneObjHolder);
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (!isGreaterStep(this, 14) && false /* isNearPlayerHipDrop */) {
                this.tearDownThrow(sceneObjHolder);
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (isGreaterEqualStep(this, 47) && !this.hasEmittedStone) {
                // getPlayerCenterPos
                getPlayerPos(scratchVec3a, sceneObjHolder);
                vec3.sub(scratchVec3a, scratchVec3a, this.translation);

                calcUpVec(scratchVec3c, this);
                const dot = vecKillElement(scratchVec3b, scratchVec3a, scratchVec3c);
                vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisZ, vec3.length(scratchVec3b));
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, dot);

                this.stone.emit(sceneObjHolder, this.throwPlanar, this.stone.translation, scratchVec3a, 15.0);
                this.hasEmittedStone = true;
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder) || distance >= 2000.0) {
                this.tearDownThrow(sceneObjHolder);
                this.setNerve(MoguNrv.Hide);
            } else if (isActionEnd(this)) {
                this.tearDownThrow(sceneObjHolder);
                this.setNerve(MoguNrv.Search);
            }
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('MoguHole');
        MoguStone.requestArchives(sceneObjHolder);
    }
}

const enum NokonokoLandType { Normal, Fast }
const enum NokonokoLandNrv { Walk, LookAround, TurnStart, Turn, TurnEnd }
export class NokonokoLand extends LiveActor<NokonokoLandNrv> {
    private type: NokonokoLandType;
    private effectAppearTrs = vec3.create();
    private pointPassChecker: MapPartsRailPointPassChecker;
    private poseQuat = quat.create();
    private axisY = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.type = fallback(getJMapInfoArg0(infoIter), NokonokoLandType.Normal);
        startBrk(this, 'NokonokoLand');
        setBrkFrameAndStop(this, this.type);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostSRT(this, 'Appear', this.effectAppearTrs, null, null);
        // initSound
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 0.0, 30.0);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Center', 8, 120.0, scratchVec3a);
        addHitSensorAtJointEnemyAttack(sceneObjHolder, this, 'attack', 'Center', 8, 60.0, scratchVec3a);
        vec3.set(scratchVec3a, 0.0, 50.0, 0.0);
        addHitSensorAtJoint(sceneObjHolder, this, 'shell', 'Turtle', HitSensorType.Nokonoko, 8, 50.0, scratchVec3a);
        invalidateHitSensor(this, 'shell');
        this.initRailRider(sceneObjHolder, infoIter);
        this.pointPassChecker = new MapPartsRailPointPassChecker(this);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.calcGravityFlag = true;
        // this.initJetTurtle(sceneObjHolder);
        // addToAttributeGroupSearchTurtle
        joinToGroupArray(sceneObjHolder, this, infoIter, null, 32);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        onCalcShadow(this);
        // initStarPointerTarget
        this.initNerve(NokonokoLandNrv.Walk);
        // tryRegisterDemoCast
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'Death');
        super.makeActorDead(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        moveCoordAndTransToNearestRailPos(this);
        this.pointPassChecker.start();
        vec3.copy(this.effectAppearTrs, this.translation);
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        const baseMtx = this.getBaseMtx()!;
        quatFromMat4(scratchQuat, baseMtx);
        quat.slerp(scratchQuat, scratchQuat, this.poseQuat, 0.3);
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, scratchQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);
        this.pointPassChecker.movement();
    }

    private startBckBtp(bck: string, btp: string = bck) {
        startBck(this, bck);
        startBtpIfExist(this, btp);
    }

    private isLookDirRailDirection(): boolean {
        quatGetAxisZ(scratchVec3a, this.poseQuat);
        getRailDirection(scratchVec3b, this);
        return isSameDirection(scratchVec3a, scratchVec3b, 0.01) && vec3.dot(scratchVec3a, scratchVec3b) >= 0.0;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: NokonokoLandNrv, deltaTimeFrames: number): void {
        if (currentNerve === NokonokoLandNrv.Walk) {
            if (isFirstStep(this)) {
                if (this.type === NokonokoLandType.Fast)
                    this.startBckBtp('WalkFastWait', 'WalkWait');
                else
                    this.startBckBtp('WalkWait');
            }

            const speed = (this.type === NokonokoLandType.Fast ? 3.2 : 1.6);
            moveCoordAndFollowTrans(this, speed * deltaTimeFrames);
            getRailDirection(scratchVec3a, this);
            vec3.negate(scratchVec3b, this.gravityVector);
            makeQuatFromVec(this.poseQuat, scratchVec3a, scratchVec3b);

            if (this.pointPassChecker.isPassed() && !this.pointPassChecker.isReachedEnd()) {
                const pointAction = fallback(getCurrentRailPointArg0(this), -1);
                if (pointAction === 0)
                    this.setNerve(NokonokoLandNrv.LookAround);
            } else if (this.pointPassChecker.isReachedEnd()) {
                this.setNerve(NokonokoLandNrv.TurnStart);
            }
        } else if (currentNerve === NokonokoLandNrv.LookAround) {
            if (isFirstStep(this))
                startBck(this, 'LookAround');
            if (isBckStopped(this))
                this.setNerve(NokonokoLandNrv.Walk);
        } else if (currentNerve === NokonokoLandNrv.TurnStart) {
            if (isFirstStep(this))
                this.startBckBtp('TurnStart', 'WalkWait');
            if (isBckStopped(this)) {
                reverseRailDirection(this);
                this.setNerve(NokonokoLandNrv.Turn);
            }
        } else if (currentNerve === NokonokoLandNrv.Turn) {
            if (isFirstStep(this)) {
                this.startBckBtp('TurnLoopStart', 'WalkWait');
                const baseMtx = this.getBaseMtx()!;
                getMatrixAxisY(this.axisY, baseMtx);
                vec3.normalize(this.axisY, this.axisY);
            }

            if (isBckOneTimeAndStopped(this))
                this.startBckBtp('TurnLoop', 'WalkWait');

            quat.setAxisAngle(scratchQuat, this.axisY, -0.02 * deltaTimeFrames);
            quat.mul(this.poseQuat, scratchQuat, this.poseQuat);

            if (this.isLookDirRailDirection())
                this.setNerve(NokonokoLandNrv.TurnEnd);
        } else if (currentNerve === NokonokoLandNrv.TurnEnd) {
            if (isFirstStep(this))
                this.startBckBtp('TurnEnd', 'WalkWait');
            if (isBckStopped(this))
                this.setNerve(NokonokoLandNrv.Walk);
        }
    }
}

function turnDirectionToTargetDegreeHorizon(dst: vec3, actor: LiveActor, target: ReadonlyVec3, speedInDegrees: number): void {
    vec3.sub(scratchVec3a, target, actor.translation);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    const speedCos = Math.cos(speedInDegrees * MathConstants.DEG_TO_RAD);
    turnVecToVecCosOnPlane(dst, dst, scratchVec3a, actor.gravityVector, speedCos);
}

function turnDirectionToPlayerDegreeHorizon(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, speedInDegrees: number): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    turnDirectionToTargetDegreeHorizon(dst, actor, scratchVec3a, speedInDegrees);
}

function turnDirectionToTarget(dst: vec3, actor: LiveActor, target: ReadonlyVec3, speedCos: number): void {
    vec3.sub(scratchVec3a, target, actor.translation);
    turnVecToVecCosOnPlane(dst, dst, scratchVec3a, actor.gravityVector, speedCos);
}

function turnDirectionToTargetDegree(dst: vec3, actor: LiveActor, target: ReadonlyVec3, speedInDegrees: number): void {
    const speedCos = Math.cos(speedInDegrees * MathConstants.DEG_TO_RAD);
    turnDirectionToTarget(dst, actor, target, speedCos);
}

function turnDirectionToPlayerDegree(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, speedInDegrees: number): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    turnDirectionToTargetDegree(dst, actor, scratchVec3a, speedInDegrees);
}

function normalize(v: number, min: number, max: number): number {
    if (isNearZero(max - min, 0.001))
        return v <= min ? 0.0 : 1.0;

    return invlerp(min, max, v);
}

function normalizeAbs(v: number, min: number, max: number): number {
    if (v < 0.0)
        return -normalize(-v, min, max);
    else
        return normalize(v, min, max);
}

function addVelocityKeepHeightUseShadow(actor: LiveActor, height: number, speedUpMult: number, speedDownMult: number, speedMax: number, shadowName: string | null = null): void {
    const shadowLength = shadowName !== null ? getShadowProjectionLength(actor, shadowName) : getShadowNearProjectionLength(actor);
    if (shadowLength === null)
        return;

    const speed = normalizeAbs(shadowLength - height, -speedMax, speedMax);
    if (speed >= 0.0)
        addVelocityToGravity(actor, speed * speedUpMult);
    else
        addVelocityToGravity(actor, speed * speedDownMult);
}

const enum KoteBugNrv { Wait, Search, EscapeSearch, FlyStart, FlyPursue, FlyEscape, FlyPursueLast, Overturn, OverturnFall, PreRecover, Blow, StampDeath, NoCalcWait }
export class KoteBug extends LiveActor<KoteBugNrv> {
    private axisZ = vec3.create();
    private centerQuat = quat.create();
    private spinHitController = new SpinHitController(15, 10, 3, 0.0, 40.0, 20.0, 3, false);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'KoteBug');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter))
            syncStageSwitchAppear(sceneObjHolder, this);

        this.initModelManagerWithAnm(sceneObjHolder, 'KoteBug');
        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.axisZ, baseMtx);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        const scale = this.scale[1];
        this.initBinder(70.0 * scale, 70.0 * scale, 0);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 20.0 * scale, 0.0);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Center', 32, 100.0 * scale, scratchVec3a);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(KoteBugNrv.Wait);
        // initStarPointerTarget
        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);
        
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 70.0 * scale);
        // TODO(jstpierre): JointController
        this.modelInstance!.jointMatrixCalcCallback = this.jointMatrixCalcCallback.bind(this);
        if (isValidSwitchAppear(this))
            this.makeActorDead(sceneObjHolder);
        else
            this.makeActorAppeared(sceneObjHolder);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        emitEffect(sceneObjHolder, this, 'Appear');
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        emitEffect(sceneObjHolder, this, 'Appear');
    }

    protected override calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.axisZ);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (isInWater(sceneObjHolder, this.translation) || isInDeath(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return;
        }

        if (this.isNerve(KoteBugNrv.Overturn) || this.isNerve(KoteBugNrv.OverturnFall) || this.isNerve(KoteBugNrv.StampDeath)) {
            quat.setAxisAngle(scratchQuat, Vec3UnitX, MathConstants.TAU / 2);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.15);
        } else if (this.isNerve(KoteBugNrv.FlyPursueLast)) {
            quat.setAxisAngle(scratchQuat, Vec3UnitX, -1.8);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.02);
        } else {
            quat.identity(scratchQuat);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.2);
        }
    }

    private jointMatrixCalcCallback(dst: mat4, modelData: J3DModelData, i: number): void {
        if (modelData.bmd.jnt1.joints[i].name === 'Center') {
            mat4.fromQuat(scratchMatrix, this.centerQuat);
            mat4.mul(dst, dst, scratchMatrix);
        }
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KoteBugNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KoteBugNrv.Wait) {
            if (isFirstStep(this)) {
                // validateClipping
                startAction(this, 'Wait');
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            const actorOnGround = isOnGround(this);
            if (actorOnGround && distance >= 1000.0) {
                this.setNerve(KoteBugNrv.NoCalcWait);
            } else if (!actorOnGround) {
                applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);
            } else {
                if (false /* isPlayerElementModeBee(sceneObjHolder) */) {
                    this.setNerve(KoteBugNrv.EscapeSearch);
                } else {
                    this.setNerve(KoteBugNrv.Search);
                }
            }
        } else if (currentNerve === KoteBugNrv.NoCalcWait) {
            if (isFirstStep(this)) {
                this.calcBinderFlag = false;
                offCalcShadow(this);
                this.calcGravityFlag = false;
            }

            vec3.zero(this.velocity);

            if (calcDistanceToPlayer(sceneObjHolder, this) < 1000.0) {
                this.calcBinderFlag = true;
                onCalcShadow(this);
                this.calcGravityFlag = true;
                this.setNerve(KoteBugNrv.Wait);
            }
        } else if (currentNerve === KoteBugNrv.Search) {
            if (isFirstStep(this))
                startAction(this, 'Syaka');

            turnDirectionToPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 5.7 * deltaTimeFrames);
            if (isGreaterStep(this, 50))
                this.setNerve(KoteBugNrv.FlyPursue);
            else if (calcDistanceToPlayer(sceneObjHolder, this) > 1000.0)
                this.setNerve(KoteBugNrv.Wait);
            else
                applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);
        } else if (currentNerve === KoteBugNrv.FlyPursue || currentNerve === KoteBugNrv.FlyEscape) {
            if (isFirstStep(this)) {
                if (currentNerve === KoteBugNrv.FlyEscape)
                    startAction(this, 'Jitabata');
                else
                    startAction(this, 'Fly');
            }

            // startLevelSound
            applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);

            if (currentNerve === KoteBugNrv.FlyEscape) {
                // turnDirectionFromPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 11.5 * deltaTimeFrames)
            } else {
                turnDirectionToPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 5.7 * deltaTimeFrames);
            }

            vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, 0.2 * deltaTimeFrames);

            if (isShadowProjected(this, null))
                addVelocityKeepHeightUseShadow(this, 100.0, 0.0, 1.8, 40.0 * deltaTimeFrames);

            if (false /* isPlayerElementModeBee(sceneObjHolder) */) {
                if (currentNerve !== KoteBugNrv.FlyEscape)
                    this.setNerve(KoteBugNrv.FlyEscape);
            } else {
                if (currentNerve !== KoteBugNrv.FlyPursue)
                    this.setNerve(KoteBugNrv.FlyPursue);
            }

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 2000.0) {
                if (currentNerve === KoteBugNrv.FlyEscape && isGreaterStep(this, 200))
                    this.setNerve(KoteBugNrv.FlyPursueLast);
            } else {
                this.setNerve(KoteBugNrv.Wait);
            }
        }
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        const bodySensor = this.getSensor('body')!;
        if (!this.isNerve(KoteBugNrv.Blow) && !this.isNerve(KoteBugNrv.StampDeath) && thisSensor === bodySensor) {
            if (isSensorPlayer(otherSensor)) {
                //
            } else if (isSensorEnemy(otherSensor)) {
                sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
            }
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (!this.isNerve(KoteBugNrv.Blow) && !this.isNerve(KoteBugNrv.StampDeath)) {
                if (isSensorEnemy(otherSensor!) || isSensorMapObj(otherSensor!)) {
                    addVelocityFromPushHorizon(this, 2.0, otherSensor!, thisSensor!);
                    return true;
                }
            }

            return false;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }
}

function turnDirectionToGround(front: vec3, actor: LiveActor): void {
    if (isBindedGround(actor)) {
        const groundNormal = getGroundNormal(actor);
        vec3.negate(scratchVec3b, groundNormal);
    } else {
        vec3.copy(scratchVec3b, actor.gravityVector);
    }

    vecKillElement(front, front, scratchVec3b);
    vec3.normalize(front, front);
}

function addVelocityToGravityOrGround(actor: LiveActor, gravitySpeed: number): void {
    if (isBindedGround(actor)) {
        const groundNormal = getGroundNormal(actor);
        vec3.scaleAndAdd(actor.velocity, actor.velocity, groundNormal, -gravitySpeed);
    } else {
        addVelocityToGravity(actor, gravitySpeed);
    }
}

function moveAndTurnToDirection(front: vec3, actor: LiveActor, frontTarget: ReadonlyVec3, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    turnVecToVecCosOnPlane(front, front, frontTarget, actor.gravityVector, Math.cos(turnSpeedDegrees * MathConstants.DEG_TO_RAD));
    turnDirectionToGround(front, actor);
    calcVelocityMoveToDirection(scratchVec3b, actor, front, moveSpeed);
    vec3.add(actor.velocity, actor.velocity, scratchVec3b);
    vec3.scale(actor.velocity, actor.velocity, velocityDamp);
    reboundVelocityFromCollision(actor, 0.0, 0.0, 1.0);
    addVelocityToGravityOrGround(actor, gravitySpeed);
}

function calcRotate(actor: LiveActor, front: ReadonlyVec3, turnSpeedDegrees: number): void {
    vec3.copy(scratchVec3c, front);

    if (isBindedGround(actor)) {
        const groundNormal = getGroundNormal(actor);
        vec3.copy(scratchVec3a, groundNormal);
    } else {
        vec3.negate(scratchVec3a, actor.gravityVector);
    }

    calcUpVec(scratchVec3b, actor);
    vec3.lerp(scratchVec3a, scratchVec3a, scratchVec3b, 0.1);
    vec3.normalize(scratchVec3a, scratchVec3a);
    if (isNearZeroVec3(scratchVec3a, 0.001))
        vec3.copy(scratchVec3a, scratchVec3b);

    makeMtxUpFront(scratchMatrix, scratchVec3a, scratchVec3c);
    computeEulerAngleRotationFromSRTMatrix(actor.rotation, scratchMatrix);
}

function moveAndTurnToTarget(actor: LiveActor, target: ReadonlyVec3, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    vec3.sub(scratchVec3b, target, actor.translation);
    calcFrontVec(scratchVec3a, actor);
    vec3.normalize(scratchVec3a, scratchVec3a);
    vec3.normalize(scratchVec3b, scratchVec3b);
    moveAndTurnToDirection(scratchVec3a, actor, scratchVec3b, moveSpeed, gravitySpeed, velocityDamp, turnSpeedDegrees);
    calcRotate(actor, scratchVec3a, turnSpeedDegrees);
}

function moveAndTurnFrontToTarget(actor: LiveActor, front: vec3, target: ReadonlyVec3, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    vec3.sub(scratchVec3b, target, actor.translation);
    moveAndTurnToDirection(front, actor, scratchVec3b, moveSpeed, gravitySpeed, velocityDamp, turnSpeedDegrees);
}

function moveAndTurnToPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    moveAndTurnToTarget(actor, scratchVec3a, moveSpeed, gravitySpeed, velocityDamp, turnSpeedDegrees);
}

function isFaceToTargetDegree(actor: LiveActor, target: ReadonlyVec3, degree: number): boolean {
    vec3.sub(scratchVec3a, target, actor.translation);
    calcFrontVec(scratchVec3b, actor);
    vec3.normalize(scratchVec3a, scratchVec3a);
    return vec3.dot(scratchVec3b, scratchVec3a) >= Math.cos(MathConstants.DEG_TO_RAD * degree);
}

function isFaceToPlayerDegree(sceneObjHolder: SceneObjHolder, actor: LiveActor, degree: number): boolean {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    return isFaceToTargetDegree(actor, scratchVec3a, degree);
}

const enum KaronNrv { Wait, FixWait, Walk, Turn, WalkOnRail, Search, Pursue }
export class Karon extends LiveActor<KaronNrv> {
    private territory = new TerritoryMover(500.0);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Karon');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);

        if (isConnectedWithRail(infoIter))
            this.initRailRider(sceneObjHolder, infoIter);

        this.initModelManagerWithAnm(sceneObjHolder, 'Karon');
        connectToSceneEnemy(sceneObjHolder, this);
        this.initBinder(70.0, 70.0, 0);
        this.calcGravityFlag = true;
        this.initEffectKeeper(sceneObjHolder, null);

        // TODO(jstpierre): useStageSwitchReadA
        this.initNerve(KaronNrv.Wait);

        this.initHitSensor();
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        initLightCtrl(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 3);

        this.territory.setCenter(this.translation);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KaronNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KaronNrv.Wait) {
            if (isFirstStep(this))
                startAction(this, 'Wait');

            if (isOnGround(this)) {
                moveAndTurnToPlayer(sceneObjHolder, this, 0.0, 2.0 * deltaTimeFrames, 0.95, 0.0);
            } else {
                moveAndTurnToPlayer(sceneObjHolder, this, 0.0, 1.2 * deltaTimeFrames, 0.8, 0.0);
            }

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0)) {
                this.setNerve(KaronNrv.Search);
            } else {
                const endStep = /* this.isNerve(KaronNrv.HitStarPieceWait) ? 120 : */ 60;
                if (isGreaterStep(this, endStep)) {
                    if (this.railRider !== null) {
                        this.setNerve(KaronNrv.WalkOnRail);
                    } else {
                        this.territory.decideNextTargetPos(this);
                        this.setNerve(KaronNrv.Walk);
                    }
                }
            }
        } else if (currentNerve === KaronNrv.Walk) {
            if (isFirstStep(this))
                startAction(this, 'Walk');

            moveAndTurnToTarget(this, this.territory.targetPos, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0))
                this.setNerve(KaronNrv.Search);
            else if (isGreaterStep(this, 180) && !this.territory.isReachedTarget(this, 40.0))
                this.setNerve(KaronNrv.Wait);
            else if (this.isFallNextMove(sceneObjHolder, true))
                this.setNerve(KaronNrv.Turn);
        } else if (currentNerve === KaronNrv.Turn) {
            if (isFirstStep(this)) {
                startAction(this, 'Walk');
                this.territory.decideNextTargetPos(this);
            }

            moveAndTurnToTarget(this, this.territory.targetPos, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0)) {
                this.setNerve(KaronNrv.Search);
            } else {
                calcFrontVec(scratchVec3a, this);
                if (isGreaterStep(this, 10) && isFaceToTargetHorizontalDegree(this, this.territory.targetPos, scratchVec3a, 2.0 * 2.0)) {
                    if (this.isFallNextMove(sceneObjHolder, false)) {
                        this.setNerve(KaronNrv.Turn);
                    } else {
                        this.setNerve(KaronNrv.Walk);
                    }
                }
            }
        } else if (currentNerve === KaronNrv.Search) {
            if (isFirstStep(this))
                startAction(this, 'Search');

            moveAndTurnToPlayer(sceneObjHolder, this, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);
            if (isActionEnd(this))
                this.setNerve(KaronNrv.Pursue);
        } else if (currentNerve === KaronNrv.Pursue) {
            if (isFirstStep(this)) {
                startAction(this, 'Pursue');
                vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -10.0);
            }

            moveAndTurnToPlayer(sceneObjHolder, this, 0.25 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);
            if (calcDistanceToPlayer(sceneObjHolder, this) > 1200.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0))
                this.setNerve(KaronNrv.Wait);
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.InhaleBlackHole) {
            this.makeActorDead(sceneObjHolder);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private isFallNextMove(sceneObjHolder: SceneObjHolder, useVelocity: boolean): boolean {
        // TODO(jstpierre): isFallOrDangerNextMove
        if (useVelocity) {
            return isFallNextMoveActor(sceneObjHolder, this, 150.0, 140.0, 150.0);
        } else {
            calcFrontVec(scratchVec3a, this);
            return isFallNextMove(sceneObjHolder, this.translation, scratchVec3a, this.gravityVector, 150.0, 140.0, 150.0);
        }
    }
}

interface SnakeheadDataTable {
    bckWaitName: string;
    bckWaylayName: string | null;
    bckForwardName: string;
    bckBackName: string;
    waitEndStep: number;
    restEndStep: number;
}

const enum SnakeheadType { Big, Small, BigRace, SmallRace }
const enum SnakeheadNrv { Wait, Waylay, MoveForward, Rest, MoveBack }
export class Snakehead extends LiveActor<SnakeheadNrv> {
    private type: SnakeheadType;
    private shadowMtx = mat4.create();
    private forwardSpeed: number;
    private backSpeed: number;
    private distanceThreshold: number;

    private static dataTable: SnakeheadDataTable[] = [
        { bckWaitName: 'StraightWait', bckWaylayName: 'StraightAppear', bckForwardName: 'StraightForward', bckBackName: 'StraightBack', waitEndStep: 14, restEndStep: 100, },
        { bckWaitName: 'Wait',         bckWaylayName: 'StraightAppear', bckForwardName: 'StraightForward', bckBackName: 'StraightBack', waitEndStep: 60, restEndStep: 120, },
        { bckWaitName: 'Wait',         bckWaylayName: null,             bckForwardName: 'Forward',         bckBackName: 'Back',         waitEndStep: 14, restEndStep: 100, },
        { bckWaitName: 'Wait',         bckWaylayName: null,             bckForwardName: 'Forward',         bckBackName: 'Back',         waitEndStep: 60, restEndStep: 120, },
    ];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        this.forwardSpeed = fallback(getJMapInfoArg0(infoIter), 15.0);
        this.backSpeed = fallback(getJMapInfoArg1(infoIter), 10.0);
        this.distanceThreshold = fallback(getJMapInfoArg2(infoIter), 1000.0);

        this.type = Snakehead.getType(infoIter);
        connectToSceneEnemy(sceneObjHolder, this);

        if (this.type === SnakeheadType.Big || this.type === SnakeheadType.BigRace) {
            initShadowController(this);
            addShadowVolumeFlatModel(sceneObjHolder, this, 'Head', 'SnakeheadShadow', this.shadowMtx);
            vec3.set(scratchVec3a, 480.0, 300.0, 680.0);
            addShadowVolumeBox(sceneObjHolder, this, 'Body', scratchVec3a);
        } else {
            initShadowVolumeFlatModel(sceneObjHolder, this, 'SnakeheadSmallShadow', this.shadowMtx);
            setShadowDropLength(this, 'SnakeheadSmallShadow', 500.0);
        }

        initLightCtrl(sceneObjHolder, this);

        this.initRailRider(sceneObjHolder, infoIter);
        setRailCoord(this, 300.0);
        moveTransToCurrentRailPos(this)

        // addToAttributeGroupSearchTurtle

        if (this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace) {
            this.initNerve(SnakeheadNrv.Wait);
        } else {
            this.initNerve(SnakeheadNrv.Waylay);
            hideModel(this);
            invalidateShadowAll(this);
        }

        this.makeActorAppeared(sceneObjHolder);
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        calcRailEndPointDirection(scratchVec3a, this);
        vec3.negate(scratchVec3b, this.gravityVector);
        makeMtxUpFrontPos(this.modelInstance!.modelMatrix, scratchVec3b, scratchVec3a, this.translation);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        mat4.copy(this.shadowMtx, getJointMtxByName(this, 'Body04')!);
    }

    private getDataTable(): SnakeheadDataTable {
        return assertExists(Snakehead.dataTable[this.type]);
    }

    private choiceAndStartBck(name: string): void {
        const dataTable = this.getDataTable();

        let bckName: string | null;
        if (name === 'Wait')
            bckName = dataTable.bckWaitName;
        else if (name === 'Waylay')
            bckName = dataTable.bckWaylayName;
        else if (name === 'Forward')
            bckName = dataTable.bckForwardName;
        else if (name === 'Back')
            bckName = dataTable.bckBackName;
        else
            throw "whoops";

        if (bckName === null)
            return;

        if (name === 'Waylay')
            startBckNoInterpole(this, bckName);
        else
            startBck(this, bckName);

        if (isBtkExist(this, bckName)) {
            startBtk(this, bckName);
        } else if (isBtkExist(this, 'Wait')) {
            startBtk(this, 'Wait');
            setBtkFrameAndStop(this, 0);
        }
    }

    private isNearPlayerFromRail(sceneObjHolder: SceneObjHolder): boolean {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        calcNearestRailPos(scratchVec3b, this, scratchVec3a);
        return vec3.distance(scratchVec3a, scratchVec3b) <= this.distanceThreshold;
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        const body04Mtx = getJointMtxByName(this, 'Body04')!;
        getMatrixTranslation(scratchVec3a, body04Mtx);
        setMatrixTranslation(this.shadowMtx, scratchVec3a);

        if (this.type === SnakeheadType.Big || this.type === SnakeheadType.BigRace) {
            const body01Mtx = getJointMtxByName(this, 'Body01')!;
            getMatrixTranslation(scratchVec3b, body01Mtx);
            const distance = vec3.distance(scratchVec3a, scratchVec3b);
            vec3.lerp(scratchVec3a, scratchVec3a, scratchVec3b, 0.5);
            setShadowDropPosition(this, 'Body', scratchVec3a);
            vec3.set(scratchVec3a, 480.0, 300.0, distance);
            setShadowVolumeBoxSize(this, 'Body', scratchVec3a);
        }
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: SnakeheadNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === SnakeheadNrv.Wait) {
            if (isFirstStep(this))
                this.choiceAndStartBck('Wait');

            const dataTable = this.getDataTable();

            if (isGreaterEqualStep(this, dataTable.waitEndStep)) {
                const isRace = this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace;
                if (isRace || this.isNearPlayerFromRail(sceneObjHolder))
                    this.setNerve(SnakeheadNrv.MoveForward);
            }
        } else if (currentNerve === SnakeheadNrv.Waylay) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Waylay');
                setBckFrameAndStop(this, 0.0);
                mat4.copy(this.shadowMtx, getJointMtxByName(this, 'Body04')!);
            }

            if (this.isNearPlayerFromRail(sceneObjHolder) && getBckFrame(this) === 0.0) {
                this.choiceAndStartBck('Waylay');
                setBckFrame(this, 1.0);
                showModel(this);
            }

            if (getBckFrame(this) >= 2.0)
                validateShadowAll(this);

            if (isBckStopped(this))
                this.setNerve(SnakeheadNrv.MoveForward);
        } else if (currentNerve === SnakeheadNrv.MoveForward) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Forward');
                setRailDirectionToEnd(this);
            }

            const isRace = this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace;
            if (isRace || !isRailReachedNearGoal(this, 300.0))
                moveCoordAndFollowTrans(this, this.forwardSpeed * deltaTimeFrames);
            else
                moveCoordAndFollowTrans(this, this.forwardSpeed / 1.5 * deltaTimeFrames);

            if (isRailReachedGoal(this))
                this.setNerve(SnakeheadNrv.Rest);
        } else if (currentNerve === SnakeheadNrv.Rest) {
            const dataTable = this.getDataTable();

            if (isGreaterEqualStep(this, dataTable.restEndStep))
                this.setNerve(SnakeheadNrv.MoveBack);
        } else if (currentNerve === SnakeheadNrv.MoveBack) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Back');
                setRailDirectionToStart(this);
            }

            moveCoordAndFollowTrans(this, this.backSpeed * deltaTimeFrames);

            if (isRailReachedNearGoal(this, 300.0)) {
                setRailCoord(this, 300.0);
                moveTransToCurrentRailPos(this);
                this.setNerve(SnakeheadNrv.Wait);
            }
        }
    }

    private static getType(infoIter: JMapInfoIter): SnakeheadType {
        const objectName = getObjectName(infoIter);
        const subtype = fallback(getJMapInfoArg3(infoIter), 0);
        if (objectName === 'Snakehead' && subtype === 0)
            return SnakeheadType.Big;
        else if (objectName === 'SnakeheadSmall' && subtype === 0)
            return SnakeheadType.Small;
        else if (objectName === 'Snakehead' && subtype === 1)
            return SnakeheadType.BigRace;
        else if (objectName === 'SnakeheadSmall' && subtype === 1)
            return SnakeheadType.SmallRace;
        else
            throw "whoops";
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const type = Snakehead.getType(infoIter);
        if (type === SnakeheadType.Big || type === SnakeheadType.BigRace) {
            sceneObjHolder.modelCache.requestObjectData('Snakehead');
            sceneObjHolder.modelCache.requestObjectData('SnakeheadShadow');
        } else {
            sceneObjHolder.modelCache.requestObjectData('SnakeheadSmall');
            sceneObjHolder.modelCache.requestObjectData('SnakeheadSmallShadow');
        }
    }
}

const enum HanachanPartsType { Head, Body, BodyS }
const enum HanachanPartsNrv { Walk }
class HanachanParts extends LiveActor<HanachanPartsNrv> {
    private type: HanachanPartsType;
    public fallVelocity = vec3.create();
    public moveVelocity = vec3.create();
    public poseQuat = quat.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, partsName: string, private partsIndex: number) {
        super(zoneAndLayer, sceneObjHolder, 'HanachanParts');

        this.initModelManagerWithAnm(sceneObjHolder, partsName);
        if (partsName === 'HanachanHead')
            this.type = HanachanPartsType.Head;
        else if (partsName === 'HanachanBody')
            this.type = HanachanPartsType.Body;
        else if (partsName === 'HanachanBodyS')
            this.type = HanachanPartsType.BodyS;
        else
            throw "whoops";

        this.initNerve(HanachanPartsNrv.Walk);
        this.initHitSensor();
        if (this.type === HanachanPartsType.Head)
            addHitSensorEnemy(sceneObjHolder, this, 'body', 32, 85.0, vec3.set(scratchVec3a, 0, 100.0, 0.0));
        else if (this.type === HanachanPartsType.Body)
            addHitSensorEnemy(sceneObjHolder, this, 'body', 32, 85.0, vec3.set(scratchVec3a, 0, 85.0, 0.0));
        else if (this.type === HanachanPartsType.BodyS)
            addHitSensorEnemy(sceneObjHolder, this, 'body', 32, 85.0, vec3.set(scratchVec3a, 0, 100.0, 0.0));

        connectToScene(sceneObjHolder, this, MovementType.None, CalcAnimType.MapObjDecoration, DrawBufferType.Enemy, DrawType.None);
        this.initBinder(100.0, 100.0, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        initLightCtrl(sceneObjHolder, this);
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 70.0);
        startBrk(this, 'Normal');

        if (this.type === HanachanPartsType.Head)
            startBva(this, 'normal');
    }

    protected override calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HanachanPartsNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HanachanPartsNrv.Walk) {
            if (isFirstStep(this)) {
                startAction(this, 'Walk');
                getBckFrameMax(this);
                setBckFrame(this, this.partsIndex * 8);
            }

            vec3.copy(this.velocity, this.fallVelocity);
            vec3.add(this.velocity, this.velocity, this.moveVelocity);

            if (isOnGround(this)) {
                vec3.zero(this.fallVelocity);
            } else {
                const commonGravity = this.getCommonGravity();
                vec3.scaleAndAdd(this.fallVelocity, this.fallVelocity, commonGravity, 0.5);
                vec3.scale(this.fallVelocity, this.fallVelocity, 0.98);
            }
        }
    }

    private getCommonGravity(): ReadonlyVec3 {
        // TODO(jstpierre)
        return this.gravityVector;
    }
}

function calcMovingDirectionAlongRail(dst: vec3, actor: LiveActor, pos: ReadonlyVec3, v1: number, killGravity: boolean): number {
    const nearestCoord = calcNearestRailPosAndDirection(scratchVec3a, scratchVec3b, actor, pos);
    actor.railRider!.setCoord(nearestCoord);

    if (!isLoopRail(actor) && isRailReachedGoal(actor)) {
        reverseRailDirection(actor);
        // TODO(jstpierre): return DidReachGoal.
    }

    if (!isRailGoingToEnd(actor))
        vec3.negate(scratchVec3b, scratchVec3b);

    vec3.sub(scratchVec3a, scratchVec3a, pos);

    if (killGravity) {
        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
        vecKillElement(scratchVec3b, scratchVec3b, actor.gravityVector);
    }

    const distance = vec3.length(scratchVec3a);
    vec3.scale(scratchVec3a, scratchVec3a, 1.0 / v1);
    vec3.add(dst, scratchVec3a, scratchVec3b);
    vec3.normalize(dst, dst);
    return distance;
}

const enum HanachanNrv { Walk }
export class Hanachan extends LiveActor<HanachanNrv> {
    private parts: HanachanParts[] = [];
    private partsHead: HanachanParts;
    private partsBodyS1: HanachanParts;
    private partsBody1: HanachanParts;
    private partsBodyS2: HanachanParts;
    private partsBody2: HanachanParts;
    private axisZ = vec3.clone(Vec3UnitZ);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Hanachan');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        connectToSceneEnemyMovement(sceneObjHolder, this);
        this.initNerve(HanachanNrv.Walk);
        declareStarPiece(sceneObjHolder, this, 6);

        this.partsHead = new HanachanParts(zoneAndLayer, sceneObjHolder, 'HanachanHead', 0);
        this.parts.push(this.partsHead);
        this.partsBodyS1 = new HanachanParts(zoneAndLayer, sceneObjHolder, 'HanachanBodyS', 1);
        this.parts.push(this.partsBodyS1);
        this.partsBody1 = new HanachanParts(zoneAndLayer, sceneObjHolder, 'HanachanBody', 2);
        this.parts.push(this.partsBody1);
        this.partsBodyS2 = new HanachanParts(zoneAndLayer, sceneObjHolder, 'HanachanBodyS', 3);
        this.parts.push(this.partsBodyS2);
        this.partsBody2 = new HanachanParts(zoneAndLayer, sceneObjHolder, 'HanachanBody', 4);
        this.parts.push(this.partsBody2);

        moveCoordToNearestPos(this);

        // Position segments
        reverseRailDirection(this);
        moveTransToOtherActorRailPos(this.partsHead, this);
        moveCoord(this, lerp(this.partsHead.getSensor('body')!.radius, this.partsBodyS1.getSensor('body')!.radius, 0.5));
        moveTransToOtherActorRailPos(this.partsBodyS1, this);
        moveCoord(this, lerp(this.partsBodyS1.getSensor('body')!.radius, this.partsBody1.getSensor('body')!.radius, 0.5));
        moveTransToOtherActorRailPos(this.partsBody1, this);
        moveCoord(this, lerp(this.partsBody1.getSensor('body')!.radius, this.partsBodyS2.getSensor('body')!.radius, 0.5));
        moveTransToOtherActorRailPos(this.partsBodyS2, this);
        moveCoord(this, lerp(this.partsBodyS2.getSensor('body')!.radius, this.partsBody2.getSensor('body')!.radius, 0.5));
        moveTransToOtherActorRailPos(this.partsBody2, this);
        reverseRailDirection(this);

        for (let i = 0; i < this.parts.length; i++)
            this.parts[i].makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        trySetMoveLimitCollision(sceneObjHolder, this.partsHead);
    }

    private setNerveAllParts(partsNerve: HanachanPartsNrv): void {
        for (let i = 0; i < this.parts.length; i++)
            this.parts[i].setNerve(partsNerve);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.parts.length; i++) {
            const parts = this.parts[i];
            if (isDead(parts))
                continue;

            parts.movement(sceneObjHolder);
            vec3.zero(parts.moveVelocity);
        }
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HanachanNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HanachanNrv.Walk) {
            if (isFirstStep(this))
                this.setNerveAllParts(HanachanPartsNrv.Walk);

            this.moveHeadAlongRail(sceneObjHolder, 4.0, deltaTimeFrames);
            this.moveBodyAlongHead(deltaTimeFrames);
        }
    }

    private moveHeadAlongRail(sceneObjHolder: SceneObjHolder, speed: number, deltaTimeFrames: number): void {
        quatGetAxisZ(this.axisZ, this.partsHead.poseQuat);
        const distance = calcMovingDirectionAlongRail(scratchVec3a, this, this.partsHead.translation, 800.0, false);

        if (distance <= 2000.0) {
            vecKillElement(scratchVec3a, scratchVec3a, this.partsHead.gravityVector);
            vec3.normalize(scratchVec3a, scratchVec3a);
            if (!isNearZeroVec3(scratchVec3a, 0.001))
                turnVecToVecRadian(this.axisZ, this.axisZ, scratchVec3a, 0.08 * deltaTimeFrames, this.partsHead.gravityVector);
            vec3.scaleAndAdd(this.partsHead.moveVelocity, this.partsHead.moveVelocity, this.axisZ, speed * deltaTimeFrames);
            vec3.negate(scratchVec3b, this.partsHead.gravityVector);

            blendQuatUpFront(this.partsHead.poseQuat, this.partsHead.poseQuat, scratchVec3b, this.axisZ, 0.5 * deltaTimeFrames, 0.5 * deltaTimeFrames);
        } else {
            this.moveHeadToPlayer(sceneObjHolder, speed, 0.04, deltaTimeFrames);
        }
    }

    private moveHeadToPlayer(sceneObjHolder: SceneObjHolder, speed: number, speed2: number, deltaTimeFrames: number): void {
        // TODO(jstpierre)
    }

    private moveBodyAlongHead(deltaTimeFrames: number): void {
        for (let i = 1; i < this.parts.length; i++) {
            const p0 = this.parts[i - 1];
            const p1 = this.parts[i];

            const s0 = p0.getSensor('body')!;
            const s1 = p1.getSensor('body')!;

            // Solve spring system
            vec3.sub(scratchVec3a, s1.center, s0.center);
            normToLength(scratchVec3a, 2.0 + lerp(s0.radius, s1.radius, 0.5));
            vec3.add(p1.moveVelocity, p1.moveVelocity, scratchVec3a);
            vec3.sub(scratchVec3b, s0.center, s1.center);
            vec3.add(p1.moveVelocity, p1.moveVelocity, scratchVec3b);

            // Adjust facing direction
            vec3.sub(scratchVec3a, s0.center, s1.center);
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.negate(scratchVec3b, p1.gravityVector);
            blendQuatUpFront(p1.poseQuat, p1.poseQuat, scratchVec3b, scratchVec3a, 0.3, 0.5);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('HanachanHead');
        sceneObjHolder.modelCache.requestObjectData('HanachanBody');
        sceneObjHolder.modelCache.requestObjectData('HanachanBodyS');
    }
}

function isHalfProbability(): boolean {
    return Math.random() >= 0.5;
}

function getSignHalfProbability(): number {
    return isHalfProbability() ? 1 : -1;
}

const enum KaninaType { Blue, Red }
const enum KaninaNrv { Appear, Wait, Walk, Dig, WaitUnderGround, FindPlayer, RunAway, RunAwayBreak, HitWall, RunAwayReboundDirection, ReboundEach, Guard, GuardEnd, DamageFireball, Turn, TurnEnd }
export class Kanina extends LiveActor<KaninaNrv> {
    private type: KaninaType;
    private initPos = vec3.create();
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private timesWalked = 0;
    private runAwayAngleDirection = 1.0;
    private runAwayTime = -1;
    private runAwayBreakTime = -1;
    private wallHitDirection = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.initPos, this.translation);
        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorMtxEnemy(sceneObjHolder, this, 'body', 8, getJointMtxByName(this, 'Body')!, 100.0, Vec3Zero);
        addHitSensorMtxEnemyAttack(sceneObjHolder, this, 'attack', 8, getJointMtxByName(this, 'Body')!, 80.0, Vec3Zero);
        this.initBinder(100.0, 100.0, 8);
        this.initEffectKeeper(sceneObjHolder, 'Kanina');
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 80.0);

        if (this.name === 'KaninaRed')
            this.type = KaninaType.Red;
        else
            this.type = KaninaType.Blue;

        if (this.type === KaninaType.Red) {
            declareCoin(sceneObjHolder, this, 1);
            declareStarPiece(sceneObjHolder, this, 3);
        } else {
            // 1-up
        }

        this.initNerve(KaninaNrv.Appear);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override calcAndSetBaseMtx(): void {
        const baseMtx = this.getBaseMtx()!;
        mat4.getRotation(scratchQuat, baseMtx);
        quat.slerp(scratchQuat, scratchQuat, this.poseQuat, 0.3);
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, scratchQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);
        this.updateMovement(sceneObjHolder);
    }

    private tryAttack(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): boolean {
        return false;
    }

    private tryPushEach(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (isSensorPlayer(thisSensor) || isSensorEnemyAttack(otherSensor) || !isSensorEnemyAttack(thisSensor))
            return;

        if (this.isNerve(KaninaNrv.ReboundEach))
            return;

        if (!sendMsgPush(sceneObjHolder, otherSensor, thisSensor))
            return;

        vec3.sub(scratchVec3a, thisSensor.center, otherSensor.center);
        vec3.normalize(scratchVec3a, scratchVec3a);
        calcUpVec(scratchVec3b, this);
        vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);

        vec3.scale(this.velocity, scratchVec3b, 1.5);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, 1.5);
        this.setNerve(KaninaNrv.ReboundEach);
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (isSensorEnemyAttack(thisSensor)) {
            if (this.tryAttack(sceneObjHolder, thisSensor, otherSensor))
                return;

            if (isSensorPlayer(otherSensor))
                sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
            else
                this.tryPushEach(sceneObjHolder, thisSensor, otherSensor);
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (otherSensor!.isType(HitSensorType.Player))
                return false;
            addVelocityFromPush(this, 1.5, otherSensor!, thisSensor!);
            if (!otherSensor!.isType(HitSensorType.CocoNut))
                this.setNerve(KaninaNrv.ReboundEach);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    private updateMovement(sceneObjHolder: SceneObjHolder): void {
        if (!isOnGround(this)) {
            let gravitySpeed: number;
            if (this.isNerve(KaninaNrv.HitWall))
                gravitySpeed = 2.2;
            else if (this.isNerve(KaninaNrv.DamageFireball))
                gravitySpeed = 1.5;
            else
                gravitySpeed = 1.0;

            addVelocityToGravity(this, gravitySpeed);
        }

        if (this.isStateStayOnGround()) {
            let drag = isOnGround(this) ? 0.93 : 0.99;
            if (this.isNerve(KaninaNrv.Guard) || this.isNerve(KaninaNrv.GuardEnd))
                drag = 0.88;
            attenuateVelocity(this, drag);
        }
    }

    private isStateStayOnGround(): boolean {
        if (this.isNerve(KaninaNrv.Walk) || this.isNerve(KaninaNrv.RunAway) || this.isNerve(KaninaNrv.RunAwayReboundDirection) || this.isNerve(KaninaNrv.DamageFireball))
            return false;

        return true;
    }

    private tryFindPlayer(sceneObjHolder: SceneObjHolder): boolean {
        calcFrontVec(scratchVec3a, this);
        if (isInSightFanPlayer(sceneObjHolder, this, scratchVec3a, 1000.0, 180.0, 30.0)) {
            this.setNerve(KaninaNrv.FindPlayer);
            return true;
        } else {
            return false;
        }
    }

    private tryHitWall(sceneObjHolder: SceneObjHolder): boolean {
        if (!isBindedWall(this))
            return false;

        if (isBindedWallOfMoveLimit(this))
            return false;

        if (!reboundVelocityFromCollision(this, 1.0, 0.0, 1.0))
            return false;

        vec3.normalize(this.wallHitDirection, this.velocity);
        this.setNerve(KaninaNrv.HitWall);
        return true;
    }

    private isPlayerBackward(sceneObjHolder: SceneObjHolder, degrees: number): boolean {
        calcFrontVec(scratchVec3a, this);
        vec3.negate(scratchVec3a, scratchVec3a);
        return isInSightFanPlayer(sceneObjHolder, this, scratchVec3a, 800, degrees * 2.0, 30.0);
    }

    private tryTurn(sceneObjHolder: SceneObjHolder): boolean {
        if (this.type === KaninaType.Blue)
            return false;

        if (this.isPlayerBackward(sceneObjHolder, 120.0)) {
            this.setNerve(KaninaNrv.Turn);
            return true;
        } else {
            return false;
        }
    }

    private tryPointing(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private getRunAwayBreakTimeRandom(): number {
        const stepRandom = Math.random();
        if (stepRandom < 0.25)
            return 10;
        else if (stepRandom < 0.50)
            return 30;
        else if (stepRandom < 0.75)
            return 60;
        else
            return 75;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KaninaNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KaninaNrv.Appear) {
            if (isFirstStep(this)) {
                startBck(this, 'Appear');
                startBtp(this, 'Normal');
                validateHitSensors(this);
            }

            if (isBckStopped(this))
                this.setNerve(KaninaNrv.Wait);
        } else if (currentNerve === KaninaNrv.Wait) {
            if (isFirstStep(this)) {
                vec3.zero(this.velocity);
                startBck(this, 'Wait');
            }

            if (!this.tryFindPlayer(sceneObjHolder) && !this.tryPointing(sceneObjHolder) && isGreaterEqualStep(this, 120)) {
                if (isBindedGroundWaterBottomH(sceneObjHolder, this) || isBindedGroundWaterBottomM(sceneObjHolder, this))
                    this.setNerve(KaninaNrv.Dig);
                else if (this.type === KaninaType.Blue && this.timesWalked > 2)
                    this.setNerve(KaninaNrv.Dig);
                else
                    this.setNerve(KaninaNrv.Walk);
            }
        } else if (currentNerve === KaninaNrv.Walk) {
            if (isFirstStep(this)) {
                this.timesWalked++;
                startBck(this, 'Walk');

                calcFrontVec(scratchVec3a, this);
                calcUpVec(scratchVec3b, this);
                const angleY = getRandomFloat(-MathConstants.TAU / 4, MathConstants.TAU / 4);
                mat4.fromRotation(scratchMatrix, angleY, scratchVec3b);
                transformVec3Mat4w0(this.axisZ, scratchMatrix, scratchVec3a);
                blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);
                quatGetAxisX(scratchVec3a, this.poseQuat);
                const speed = 3.0 * getSignHalfProbability();
                vec3.scale(this.velocity, scratchVec3a, speed);
            }

            if (!this.tryFindPlayer(sceneObjHolder) && !this.tryPointing(sceneObjHolder) && isGreaterEqualStep(this, 180)) {
                vec3.zero(this.velocity);
                this.setNerve(KaninaNrv.Wait);
            }
        } else if (currentNerve === KaninaNrv.Dig) {
            if (isFirstStep(this)) {
                this.timesWalked = 0;
                startBck(this, 'Dig');
            }

            if (isBckStopped(this))
                this.setNerve(KaninaNrv.WaitUnderGround);
        } else if (currentNerve === KaninaNrv.WaitUnderGround) {
            if (isFirstStep(this)) {
                vec3.zero(this.velocity);
                invalidateShadowAll(this);
                vec3.copy(this.translation, this.initPos);
            }

            if (isGreaterEqualStep(this, 120) && calcDistanceToPlayer(sceneObjHolder, this) > 500.0) {
                validateShadowAll(this);
                this.setNerve(KaninaNrv.Appear);
            }
        } else if (currentNerve === KaninaNrv.FindPlayer) {
            if (isFirstStep(this)) {
                startBck(this, 'Search');
                calcVecToPlayerH(this.axisZ, sceneObjHolder, this);
            }

            if (isBckStopped(this))
                this.setNerve(KaninaNrv.RunAway);
        } else if (currentNerve === KaninaNrv.RunAway) {
            if (isFirstStep(this)) {
                if (this.type === KaninaType.Red) {
                    startBck(this, 'ChaseRun');
                    startBtp(this, 'Angry');
                } else {
                    startBck(this, 'Run');
                }

                setBckRate(this, 1.0);
                calcVecFromPlayerH(scratchVec3a, sceneObjHolder, this);

                const angleMax = (this.type === KaninaType.Red ? 30.0 : 60.0) * -1 * this.runAwayAngleDirection;
                calcUpVec(scratchVec3b, this);
                mat4.fromRotation(scratchMatrix, angleMax * MathConstants.DEG_TO_RAD, scratchVec3b);
                transformVec3Mat4w0(scratchVec3c, scratchMatrix, scratchVec3a);

                if (this.type === KaninaType.Red)
                    vec3.negate(scratchVec3c, scratchVec3c);
                vec3.normalize(scratchVec3c, scratchVec3c);

                const speed = this.type === KaninaType.Red ? 7.0 : 13.0;
                vec3.scale(this.velocity, scratchVec3c, speed);

                const direction = this.runAwayAngleDirection * -1.0 * 75.0;
                mat4.fromRotation(scratchMatrix, direction * MathConstants.DEG_TO_RAD, scratchVec3b);
                transformVec3Mat4w0(scratchVec3c, scratchMatrix, scratchVec3a);
                vec3.scale(scratchVec3c, scratchVec3c, this.runAwayAngleDirection);
                makeQuatSideUp(scratchQuat, scratchVec3c, scratchVec3b);
                quatGetAxisZ(this.axisZ, scratchQuat);

                const stepRandom = Math.random();
                if (stepRandom < 0.25)
                    this.runAwayTime = 15;
                else if (stepRandom < 0.50)
                    this.runAwayTime = 30;
                else if (stepRandom < 0.75)
                    this.runAwayTime = 60;
                else
                    this.runAwayTime = 75;

                this.runAwayAngleDirection *= -1.0;
            }

            if (!this.tryHitWall(sceneObjHolder) && !this.tryPointing(sceneObjHolder)) {
                const distToPlayer = calcDistanceToPlayerH(sceneObjHolder, this);
                if (distToPlayer >= 2000.0) {
                    vec3.zero(this.velocity);
                    if (this.type === KaninaType.Blue)
                        this.setNerve(KaninaNrv.Dig);
                    else if (isHalfProbability())
                        this.setNerve(KaninaNrv.Dig);
                    else
                        this.setNerve(KaninaNrv.Wait);
                } else if (isGreaterEqualStep(this, this.runAwayTime)) {
                    vec3.zero(this.velocity);
                    this.setNerve(KaninaNrv.RunAwayBreak);
                }
            }
        } else if (currentNerve === KaninaNrv.RunAwayBreak) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                this.runAwayBreakTime = this.getRunAwayBreakTimeRandom();
            }

            if (!this.tryTurn(sceneObjHolder) && !this.tryPointing(sceneObjHolder) && isGreaterEqualStep(this, this.runAwayBreakTime)) {
                if (isBindedGroundWaterBottomH(sceneObjHolder, this) || isBindedGroundWaterBottomM(sceneObjHolder, this))
                    this.setNerve(KaninaNrv.Dig);
                else
                    this.setNerve(KaninaNrv.RunAway);
            }
        } else if (currentNerve === KaninaNrv.HitWall) {
            if (isFirstStep(this)) {
                // this.jointRumbler.start();

                calcUpVec(scratchVec3b, this);
                vecKillElement(scratchVec3a, this.wallHitDirection, scratchVec3b);
                vec3.normalize(scratchVec3a, scratchVec3a);
                makeQuatSideUp(this.poseQuat, scratchVec3a, scratchVec3b);

                vec3.scale(this.velocity, scratchVec3b, 20.0);
                vec3.scaleAndAdd(this.velocity, this.velocity, this.wallHitDirection, 6.0);
            }

            if (isGreaterStep(this, 10) && isBindedGround(this))
                this.setNerve(KaninaNrv.RunAwayReboundDirection);
        } else if (currentNerve === KaninaNrv.RunAwayReboundDirection) {
            if (isFirstStep(this)) {
                startBck(this, 'Run');
                setBckRate(this, 1.0);

                calcUpVec(scratchVec3b, this);
                vecKillElement(scratchVec3a, this.wallHitDirection, scratchVec3b);
                vec3.normalize(scratchVec3a, scratchVec3a);
                const speed = this.type === KaninaType.Red ? 7.0 : 13.0;
                vec3.scale(this.velocity, scratchVec3a, speed);

                this.runAwayTime = this.getRunAwayBreakTimeRandom();
                this.runAwayAngleDirection *= -1.0;
            }

            if (!this.tryHitWall(sceneObjHolder) && !this.tryPointing(sceneObjHolder)) {
                const distToPlayer = calcDistanceToPlayer(sceneObjHolder, this);
                if (distToPlayer >= 2000.0) {
                    this.setNerve(KaninaNrv.Wait);
                } else if (isGreaterEqualStep(this, this.runAwayTime)) {
                    this.setNerve(KaninaNrv.RunAwayBreak);
                }
            }
        } else if (currentNerve === KaninaNrv.ReboundEach) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                // this.jointRumbler.start();
            }

            if (isGreaterStep(this, 10) && isBindedGround(this))
                this.setNerve(KaninaNrv.RunAwayReboundDirection);
        } else if (currentNerve === KaninaNrv.Turn) {
            if (isFirstStep(this))
                startBck(this, 'Turn');

            getPlayerPos(scratchVec3a, sceneObjHolder);
            const done = turnDirectionToTargetUseGroundNormalDegree(this, this.axisZ, scratchVec3a, 1.7 * deltaTimeFrames);
            if (done)
                this.setNerve(KaninaNrv.TurnEnd);
        } else if (currentNerve === KaninaNrv.TurnEnd) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            if (isGreaterEqualStep(this, 30))
                this.setNerve(KaninaNrv.RunAway);
        }
    }
}

const enum PetariNrv { Lurk, JumpOut, Wait, Approach, Escape }
export class Petari extends LiveActor<PetariNrv> {
    private axisZ = vec3.create();
    private starPieceCount: number;
    private targetAxisZ = vec3.clone(Vec3UnitZ);
    private center = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Petari');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        this.initBinder(60.0, 60.0, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        initShadowFromCSV(sceneObjHolder, this);
        this.initNerve(PetariNrv.Lurk);
        calcFrontVec(this.axisZ, this);
        this.calcGravityFlag = true;
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter))
            syncStageSwitchAppear(sceneObjHolder, this);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);

        this.starPieceCount = fallback(getJMapInfoArg1(infoIter), 20);
        declareStarPiece(sceneObjHolder, this, this.starPieceCount);

        this.makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        hideModel(this);
        this.setNerve(PetariNrv.Lurk);
        super.makeActorAppeared(sceneObjHolder);
    }

    private calcCenter(): void {
        vec3.scaleAndAdd(this.center, this.translation, this.gravityVector, -60.0);
    }

    private calcApproachDirection(sceneObjHolder: SceneObjHolder): void {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(this.targetAxisZ, scratchVec3a, this.center);
        if (isNearZeroVec3(this.targetAxisZ, 0.001))
            vec3.copy(this.targetAxisZ, this.axisZ);
        vec3.normalize(this.targetAxisZ, this.targetAxisZ);
    }

    private calcEscapeDirection(sceneObjHolder: SceneObjHolder): void {
        this.calcApproachDirection(sceneObjHolder);
        vec3.negate(this.targetAxisZ, this.targetAxisZ);
    }

    private updateFootPrint(sceneObjHolder: SceneObjHolder): void {
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PetariNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PetariNrv.Lurk) {
            if (isFirstStep(this))
                vec3.zero(this.velocity);

            this.tryShiftJumpOut(sceneObjHolder);
        } else if (currentNerve === PetariNrv.JumpOut) {
            this.setNerve(PetariNrv.Wait);
        } else if (currentNerve === PetariNrv.Wait) {
            if (isFirstStep(this))
                vec3.zero(this.velocity);

            const moveSpeed = 0.0;
            moveAndTurnToDirection(this.axisZ, this, this.targetAxisZ, moveSpeed * deltaTimeFrames, 1.3 * deltaTimeFrames, Math.pow(0.92, deltaTimeFrames), 3.0 * deltaTimeFrames);

            if (isGreaterEqualStep(this, 60) && !isBckPlaying(this, 'Wait')) {
                if (isHiddenModel(this)) {
                    showModel(this);
                    emitEffect(sceneObjHolder, this, 'LeaveAppearanceSmoke');
                    startBckNoInterpole(this, 'Wait');
                } else {
                    startBckWithInterpole(this, 'Wait', 30);
                }
            }

            if (this.reflectStarPointer2P(sceneObjHolder))
                return;

            if (this.tryShiftApproach(sceneObjHolder) || this.tryShiftEscape(sceneObjHolder)) {
                if (!isHiddenModel(this)) {
                    emitEffect(sceneObjHolder, this, 'LeaveAppearanceSmoke');
                    forceDeleteEffect(sceneObjHolder, this, 'LeaveAppearanceInnerLight');
                }
            }
        } else if (currentNerve === PetariNrv.Approach) {
            if (isFirstStep(this)) {
                if (!isHiddenModel(this)) {
                    // hideModel(this);
                    emitEffect(sceneObjHolder, this, 'StartSmoke');
                }
            }

            this.calcCenter();
            this.calcApproachDirection(sceneObjHolder);

            const moveSpeed = isBindedGround(this) ? 0.5 : 0.0;
            moveAndTurnToDirection(this.axisZ, this, this.targetAxisZ, moveSpeed * deltaTimeFrames, 1.3 * deltaTimeFrames, Math.pow(0.92, deltaTimeFrames), 3.0 * deltaTimeFrames);
            this.updateFootPrint(sceneObjHolder);

            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'WalkSmoke');

            if (this.reflectStarPointer2P(sceneObjHolder))
                this.tryApproachEnd(sceneObjHolder);
        }
    }

    private reflectStarPointer2P(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryApproachEnd(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryShiftApproach(sceneObjHolder: SceneObjHolder): boolean {
        return false;

        if (calcDistanceToPlayer(sceneObjHolder, this) > 700.0) {
            this.setNerve(PetariNrv.Approach);
            return true;
        } else {
            return false;
        }
    }

    private tryShiftEscape(sceneObjHolder: SceneObjHolder): boolean {
        if (calcDistanceToPlayer(sceneObjHolder, this) < 500.0) {
            this.setNerve(PetariNrv.Escape);
            return true;
        } else {
            return false;
        }
    }

    private tryShiftJumpOut(sceneObjHolder: SceneObjHolder): boolean {
        if (calcDistanceToPlayer(sceneObjHolder, this) >= 1500.0)
            return false;

        // if (!calcScreenPosition(sceneObjHolder, this)) return false;

        this.setNerve(PetariNrv.JumpOut);
        return true;
    }
}

function isPlayerInWaterMode(sceneObjHolder: SceneObjHolder): boolean {
    return isCameraInWater(sceneObjHolder);
}

function isNearVec3(a: LiveActor, b: ReadonlyVec3, threshold: number): boolean {
    return vec3.squaredDistance(a.translation, b) >= (threshold ** 2);
}

const enum GessoNrv { Wait, Search, WalkCharge, Walk, Sink, ComeFromBox, ComeBack, LostPlayer, Attack, PunchDown }
export class Gesso extends LiveActor<GessoNrv> {
    private origTranslation = vec3.create();
    private axisY = vec3.create();
    private axisYTarget = vec3.create();
    private axisZ = vec3.create();
    private pushVelocity = vec3.create();
    private walkHighSpeedMode = false;
    private walkIsMarioLeft = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.origTranslation, this.translation);
        this.initModelManagerWithAnm(sceneObjHolder, 'Gesso');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.KillerTargetEnemy, 8, 100.0, Vec3Zero);
        this.initBinder(150, 0.0, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // addHitEffectNormal();
        // initSound();
        // initStarPointerTarget();
        initShadowVolumeSphere(sceneObjHolder, this, 90.0);
        calcFrontVec(this.axisZ, this);
        calcUpVec(this.axisY, this);
        vec3.copy(this.axisYTarget, this.axisY);
        declareCoin(sceneObjHolder, this, 1);
        // addToAttributeGroupSearchTurtle();

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
            if (arg0 === 0) {
                this.initNerve(GessoNrv.ComeFromBox);
            } else {
                this.initNerve(GessoNrv.Wait);
            }
            this.makeActorDead(sceneObjHolder);
        } else {
            this.initNerve(GessoNrv.Wait);
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (this.isNerve(GessoNrv.PunchDown))
            return;

        if (isSensorEnemy(thisSensor) && isSensorPlayer(otherSensor)) {
            if (sendMsgEnemyAttackStrong(sceneObjHolder, otherSensor, thisSensor)) {
                // emitEffectHitBetweenSensors();

                vec3.sub(scratchVec3a, thisSensor.center, otherSensor.center);
                vec3.normalize(scratchVec3a, scratchVec3a);
                vec3.scale(this.velocity, scratchVec3a, 25.0);
                this.setNerve(GessoNrv.Attack);
            }
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (isSensorEnemy(otherSensor!) || isSensorMapObj(otherSensor!)) {
                vec3.sub(scratchVec3a, this.translation, otherSensor!.actor.translation);
                vec3.normalize(scratchVec3a, scratchVec3a);
                vec3.scaleAndAdd(this.pushVelocity, this.pushVelocity, scratchVec3a, 0.2);
                return true;
            }

            return false;
        } else if (isMsgTypeEnemyAttack(messageType)) {
            if (this.isNerve(GessoNrv.PunchDown))
                return false;

            if (messageType === MessageType.EnemyAttackExplosion) {
                this.knockOut(sceneObjHolder, otherSensor!, thisSensor!);
                return true;
            } else if (otherSensor!.isType(HitSensorType.Unizo)) {
                this.knockOut(sceneObjHolder, otherSensor!, thisSensor!);
            }

            return false;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    private knockOut(sceneObjHolder: SceneObjHolder, otherSensor: HitSensor, thisSensor: HitSensor): void {
        vec3.sub(scratchVec3a, thisSensor.center, otherSensor.center);
        vec3.normalize(scratchVec3a, scratchVec3a);
        vec3.scale(this.velocity, scratchVec3a, 30.0);
        turnDirectionToTarget(this.axisZ, this, otherSensor.center, -1.0);
        this.setNerve(GessoNrv.PunchDown);
    }

    private clipAndInitPos(sceneObjHolder: SceneObjHolder): boolean {
        // TODO(jstpierre)
        return false;
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (this.clipAndInitPos(sceneObjHolder))
            return;

        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        turnVecToVecCosOnPlane(this.axisY, this.axisY, this.axisYTarget, this.axisZ, Math.cos(MathConstants.DEG_TO_RAD * 0.5 * deltaTimeFrames));

        const pushAmount = vec3.dot(this.velocity, this.pushVelocity);
        if (pushAmount < 0.0)
            vec3.scaleAndAdd(this.velocity, this.velocity, this.pushVelocity, -pushAmount);

        vec3.add(this.velocity, this.velocity, this.pushVelocity);
        vec3.scale(this.pushVelocity, this.pushVelocity, 0.7 * deltaTimeFrames);
        if (isNearZeroVec3(this.pushVelocity, 0.001))
            vec3.zero(this.pushVelocity);

        vec3.negate(scratchVec3a, this.gravityVector);
        vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3a, 50.0);
        const buoyAmount = vec3.dot(this.velocity, scratchVec3a);
        if (!isInWater(sceneObjHolder, scratchVec3b) && buoyAmount >= 0.0)
            vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, -buoyAmount);

        /*
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.translation, GessoNrv[this.getCurrentNerve()], 0, White, { outline: 4 });
        const status1 = `Walk: ${this.walkHighSpeedMode ? 'High Speed' : 'Normal'}, ${this.walkIsMarioLeft ? 'Left' : 'Right'}`;
        const status2 = `Next: ${this.walkHighSpeedMode ? 'High Speed' : 'Normal'}, ${this.isMarioUp(sceneObjHolder) ? 'Up' : 'Down'}, ${this.isMarioLeft(sceneObjHolder) ? 'Left' : 'Right'}`;
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.translation, status1, 16, White, { outline: 4 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.translation, status2, 32, White, { outline: 4 });
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.translation, `Up Target: ${this.axisYTarget}`, 48, White, { outline: 4 });
        */
    }

    public override calcAndSetBaseMtx(): void {
        makeMtxUpFrontPos(this.modelInstance!.modelMatrix, this.axisY, this.axisZ, this.translation);
    }

    private kill(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'Death');
        appearCoinPop(sceneObjHolder, this, this.translation, 1);
        this.makeActorDead(sceneObjHolder);
    }

    private calcAndSetUpVecTarget(x: number, y: number, z: number): void {
        if (x === 0.0 && y === 0.0 && z === 0.0) {
            vec3.copy(this.axisYTarget, Vec3UnitY);
        } else {
            vec3.set(this.axisYTarget, x, y, z);
            vec3.normalize(this.axisYTarget, this.axisYTarget);
        }
    }

    private tryChangeHighSpeedMode(sceneObjHolder: SceneObjHolder): boolean {
        this.walkHighSpeedMode = isNearPlayer(sceneObjHolder, this, 1000.0) && isPlayerInWaterMode(sceneObjHolder);
        return this.walkHighSpeedMode;
    }

    private isMarioLeft(sceneObjHolder: SceneObjHolder): boolean {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        calcSideVec(scratchVec3b, this);
        return vec3.dot(scratchVec3a, scratchVec3b) >= 0.0;
    }

    private isMarioUp(sceneObjHolder: SceneObjHolder): boolean {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        vec3.negate(scratchVec3b, this.gravityVector);
        return vec3.dot(scratchVec3a, scratchVec3b) >= 0.0;
    }

    private selectNextNerve(sceneObjHolder: SceneObjHolder): void {
        if (!isPlayerInWaterMode(sceneObjHolder))
            this.setNerve(GessoNrv.ComeBack);
        else if (!isNearPlayer(sceneObjHolder, this, 2400))
            this.setNerve(GessoNrv.LostPlayer);
        else if (this.isMarioUp(sceneObjHolder))
            this.setNerve(GessoNrv.WalkCharge);
        else if (!this.isNerve(GessoNrv.Sink))
            this.setNerve(GessoNrv.Sink);
    }

    private calcAndSetVelocity(x: number, y: number, z: number): void {
        calcSideVec(scratchVec3a, this);
        vec3.scale(this.velocity, scratchVec3a, x);

        calcUpVec(scratchVec3a, this);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, y);

        vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, z);
    }

    private calcWalkMove(step: number, deltaTimeFrames: number): boolean {
        const stepDeg = step * 0.990099;

        const upSpeed = 7.0 * Math.cos(stepDeg * MathConstants.DEG_TO_RAD);
        const sideDir = this.walkIsMarioLeft ? 1.0 : -1.0;
        const sideSpeed = sideDir * (this.walkHighSpeedMode ? 3.0 : (3.0 / 5.0));
        this.calcAndSetVelocity(sideSpeed * deltaTimeFrames, upSpeed * deltaTimeFrames, 2.3 * deltaTimeFrames);

        if (isFirstStep(this)) {
            const chargeSideSpeedMul = this.walkHighSpeedMode ? (3.0 / 2.0) : (3.0 / 5.0);
            this.calcAndSetUpVecTarget(chargeSideSpeedMul, upSpeed, 4.6);
        }

        if (stepDeg >= 70.0)
            this.calcAndSetUpVecTarget(0.0, 1.0, 1.0);

        return stepDeg > 100.0;
    }

    private calcSinkMove(step: number, deltaTimeFrames: number): boolean {
        const stepDeg = Math.min(step * 3.0 + 100.0, 180.0);

        const upSpeed = 3.0 * Math.cos(stepDeg * MathConstants.DEG_TO_RAD);
        const sideDir = this.walkIsMarioLeft ? 1.0 : -1.0;
        const sideSpeed = sideDir * 3.0;
        this.calcAndSetVelocity(sideSpeed * deltaTimeFrames, upSpeed * deltaTimeFrames, 2.3 * deltaTimeFrames);
        this.calcAndSetUpVecTarget(0.0, 1.0, 1.0);

        return stepDeg >= 180.0;
    }

    private calcVelocityBob(step: number, deltaTimeFrames: number): void {
        const speed = Math.sin(MathConstants.DEG_TO_RAD * (45.0 + 2.0 * step)) * deltaTimeFrames;
        vec3.scale(this.velocity, this.gravityVector, speed * 1.5);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: GessoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === GessoNrv.Wait) {
            if (isFirstStep(this)) {
                startAction(this, 'Wait');
                this.calcAndSetUpVecTarget(0.0, 0.0, 0.0);
            }

            this.calcVelocityBob(this.getNerveStep(), deltaTimeFrames);
            rotateVecDegree(this.axisZ, this.gravityVector, 0.3 * deltaTimeFrames);

            if (isNearPlayer(sceneObjHolder, this, 1400) && isPlayerInWaterMode(sceneObjHolder))
                this.setNerve(GessoNrv.Search);
        } else if (currentNerve === GessoNrv.Search) {
            if (isFirstStep(this)) {
                startAction(this, 'Search');
                this.calcAndSetUpVecTarget(0.0, 0.0, 0.0);
            }

            this.calcVelocityBob(this.getNerveStep(), deltaTimeFrames);
            turnDirectionToPlayerDegree(this.axisZ, sceneObjHolder, this, 1.5 * deltaTimeFrames);

            if (isFaceToPlayerHorizontalDegree(sceneObjHolder, this, this.axisZ, 1.5) && isActionEnd(this))
                this.setNerve(GessoNrv.WalkCharge);
        } else if (currentNerve === GessoNrv.WalkCharge) {
            if (isFirstStep(this)) {
                if (this.tryChangeHighSpeedMode(sceneObjHolder))
                    startAction(this, 'WalkFast');
                else
                    startAction(this, 'Walk');

                this.calcAndSetUpVecTarget(0.0, 1.0, 1.0);
            }

            vec3.scale(this.velocity, this.velocity, Math.pow(0.995, deltaTimeFrames));
            if (isGreaterEqualStep(this, 43)) {
                this.walkIsMarioLeft = this.isMarioLeft(sceneObjHolder);
                this.setNerve(GessoNrv.Walk);
            }
        } else if (currentNerve === GessoNrv.Walk) {
            turnDirectionToPlayerDegree(this.axisZ, sceneObjHolder, this, 1.5 * deltaTimeFrames);
            if (this.calcWalkMove(this.getNerveStep(), deltaTimeFrames))
                this.selectNextNerve(sceneObjHolder);
        } else if (currentNerve === GessoNrv.Sink) {
            if (isFirstStep(this)) {
                if (isNearPlayer(sceneObjHolder, this, 1000.0))
                    startAction(this, 'SinkFast');
                else
                    startAction(this, 'Sink');
            }

            turnDirectionToPlayerDegree(this.axisZ, sceneObjHolder, this, 1.5 * deltaTimeFrames);
            if (isBindedGround(this)) {
                this.setNerve(GessoNrv.WalkCharge);
            } else {
                if (this.calcSinkMove(this.getNerveStep(), deltaTimeFrames))
                    this.selectNextNerve(sceneObjHolder);
            }
        } else if (currentNerve === GessoNrv.ComeFromBox) {
            if (isFirstStep(this)) {
                startAction(this, 'FromBox');
                invalidateHitSensors(this);

                vec3.scaleAndAdd(this.translation, this.translation, this.gravityVector, -100.0);
                this.calcAndSetUpVecTarget(0.0, 1.0, 0.3);
            }

            if (isLessStep(this, 10.0)) {
                this.calcAndSetVelocity(0.0, 10.0, 5.0);
            } else {
                vec3.zero(this.velocity);
            }

            if (isActionEnd(this)) {
                vec3.zero(this.velocity);
                validateHitSensors(this);
                this.setNerve(GessoNrv.Wait);
            }
        } else if (currentNerve === GessoNrv.ComeBack) {
            if (isFirstStep(this))
                startAction(this, 'CoolDown');
            
            if (isBckPlaying(this, 'CoolDown')) {
                this.calcVelocityBob(this.getNerveStep(), deltaTimeFrames);
            } else {
                if (isBckOneTimeAndStopped(this))
                    startAction(this, 'Sink');

                if (isPlayerInWaterMode(sceneObjHolder)) {
                    this.setNerve(GessoNrv.Wait);
                } else {
                    turnDirectionToPlayerDegree(this.axisZ, sceneObjHolder, this, 1.5 * deltaTimeFrames);
                    vec3.sub(scratchVec3a, this.origTranslation, this.translation);
                    vec3.normalize(scratchVec3a, scratchVec3a);
                    vec3.scale(this.velocity, scratchVec3a, 3.0);

                    if (isNearVec3(this, this.origTranslation, 300.0))
                        this.setNerve(GessoNrv.Wait);
                }
            }
        } else if (currentNerve === GessoNrv.LostPlayer) {
            if (isFirstStep(this)) {
                startAction(this, 'CoolDown');
                this.calcAndSetUpVecTarget(0.0, 0.0, 0.0);
            }

            this.calcVelocityBob(this.getNerveStep(), deltaTimeFrames);

            if (isActionEnd(this))
                this.setNerve(GessoNrv.Wait);
        } else if (currentNerve === GessoNrv.Attack) {
            if (isFirstStep(this)) {
                startAction(this, 'Attack');
                this.calcAndSetUpVecTarget(0.0, 0.0, 0.0);
            }

            if (isBckOneTimeAndStopped(this))
                startAction(this, 'Wait');

            if (isBckPlaying(this, 'Attack'))
                this.calcVelocityBob(this.getNerveStep(), deltaTimeFrames);
            else
                vec3.scale(this.velocity, this.velocity, Math.pow(0.9, deltaTimeFrames));

            if (isGreaterEqualStep(this, 240))
                this.setNerve(GessoNrv.Wait);
        } else if (currentNerve === GessoNrv.PunchDown) {
            if (isFirstStep(this)) {
                invalidateHitSensors(this);
                startAction(this, 'PunchDown');
            }

            turnDirectionToPlayerDegree(this.axisZ, sceneObjHolder, this, 1.5 * deltaTimeFrames);
            if (isGreaterEqualStep(this, 20) || isBinded(this))
                this.kill(sceneObjHolder);
        }
    }
}

const enum BirikyuNrv { Move, MoveCircle, WaitAtEdge, }
export class Birikyu extends LiveActor<BirikyuNrv> {
    protected axisY = vec3.clone(Vec3UnitY);
    protected axisZ = vec3.clone(Vec3UnitZ);
    protected rotateAngle = 0;

    private speed: number = 0;
    private origTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneMapObj(sceneObjHolder, this);

        // initFromJmpArgs
        this.speed = fallback(getJMapInfoArg0(infoIter), 10.0);
        const hasShadow = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));

        // initRail
        if (isConnectedWithRail(infoIter))
            this.initRailRider(sceneObjHolder, infoIter);

        initDefaultPos(sceneObjHolder, this, infoIter);

        // initCollision
        this.initHitSensor();
        const hitRadius = this.getHitRadius();
        const centerJointName = this.getCenterJointName();
        const bodySensor = addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', centerJointName, 16, hitRadius, Vec3Zero);

        // initShadow
        if (hasShadow) {
            initShadowVolumeSphere(sceneObjHolder, this, hitRadius);
            onCalcShadowDropPrivateGravity(this);
            onCalcShadow(this);
            this.calcGravityFlag = true;
            setShadowDropPositionPtr(this, null, bodySensor.center);
        }

        this.initEffectKeeper(sceneObjHolder, null);
        joinToGroupArray(sceneObjHolder, this, infoIter, null, 64);

        if (this.railRider !== null)
            this.initNerve(BirikyuNrv.Move);
        else
            this.initNerve(BirikyuNrv.MoveCircle);

        this.makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (this.railRider !== null) {
            moveCoordAndTransToNearestRailPos(this);
        } else {
            vec3.copy(this.origTranslation, this.translation);
            calcUpVec(this.axisY, this);
            calcFrontVec(this.axisZ, this);
            vec3.scaleAndAdd(this.translation, this.origTranslation, this.axisZ, 400.0);
        }
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        emitEffect(sceneObjHolder, this, this.name);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: BirikyuNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === BirikyuNrv.Move) {
            if (isRailReachedGoal(this)) {
                reverseRailDirection(this);
                const waitTime = fallback(getCurrentRailPointArg0(this), 0);
                if (waitTime > 0) {
                    this.setNerve(BirikyuNrv.WaitAtEdge);
                }
                emitEffect(sceneObjHolder, this, 'Clash');
            }

            moveCoordAndFollowTrans(this, this.speed * deltaTimeFrames);
        } else if (currentNerve === BirikyuNrv.MoveCircle) {
            this.rotateAngle += (this.speed / 400.0) * deltaTimeFrames;
            mat4.fromRotation(scratchMatrix, this.rotateAngle, this.axisY);
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, this.axisZ);
            vec3.scaleAndAdd(this.translation, this.origTranslation, scratchVec3a, 400.0);
        } else if (currentNerve === BirikyuNrv.WaitAtEdge) {
            const waitTime = getCurrentRailPointArg0(this)!;
            if (isGreaterEqualStep(this, waitTime))
                this.setNerve(BirikyuNrv.Move);
        }
    }

    protected getHitRadius(): number {
        return 120.0;
    }

    protected getCenterJointName(): string {
        return 'Root';
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (isSensorPlayerOrRide(otherSensor) || isSensorEnemy(otherSensor)) {
            if (sendMsgEnemyAttackElectric(sceneObjHolder, otherSensor, thisSensor)) {
                // sendMsgToGroupMember(sceneObjHolder, MessageType.Pressure_StartSyncWait, this, 'body');
                // this.setNerve(BirikyuNrv.Attack);
            } else {
                sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
            }
        }
    }
}

export class BirikyuWithFace extends Birikyu {
    private faceOutwards = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
        this.faceOutwards = getJMapInfoBool(fallback(getJMapInfoArg1(infoIter), -1));
    }

    public override calcAndSetBaseMtx(): void {
        const dst = this.modelInstance!.modelMatrix;

        if (this.railRider !== null) {
            getRailDirection(scratchVec3a, this);
            if (this.faceOutwards === isRailGoingToEnd(this))
                vec3.negate(scratchVec3a, scratchVec3a);

            if (isSameDirection(scratchVec3a, this.axisY, 0.01))
                makeMtxSideFront(dst, scratchVec3a, this.axisZ);
            else
                makeMtxSideUp(dst, scratchVec3a, this.axisY);
        } else {
            mat4.fromRotation(dst, this.rotateAngle, this.axisY);
        }

        setMatrixTranslation(dst, this.translation);
    }

    protected override getHitRadius(): number {
        return 50.0;
    }

    protected override getCenterJointName(): string {
        return 'Center';
    }
}

const enum TakoHeiInkNrv { Wait, }
class TakoHeiInk extends LiveActor<TakoHeiInkNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, 'TakoHeiInk');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'TakoHeiInk');
        connectToSceneEnemy(sceneObjHolder, this);
        this.calcGravityFlag = true;
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 50.0, Vec3Zero);
        this.initBinder(50.0, 0.0, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // this.initSound();
        initShadowVolumeSphere(sceneObjHolder, this, 50.0);
        this.initNerve(TakoHeiInkNrv.Wait);
        this.makeActorDead(sceneObjHolder);
    }

    public start(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, velocity: ReadonlyVec3, noBind: boolean): void {
        vec3.copy(this.translation, pos);
        this.setNerve(TakoHeiInkNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
        vec3.copy(this.velocity, velocity);
        this.calcBinderFlag = !noBind;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TakoHeiInkNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TakoHeiInkNrv.Wait) {
            if (isFirstStep(this))
                tryStartBck(this, 'Wait');
            if (isGreaterStep(this, 10) && !this.calcBinderFlag)
                this.calcBinderFlag = true;
            addVelocityToGravity(this, 0.8);
            attenuateVelocity(this, 0.99);
            if (isBinded(this) || isGreaterStep(this, 240))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('TakoHeiInk');
    }
}

export class TakoHeiInkHolder extends LiveActorGroup<TakoHeiInk> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'TakoHeiHolder', 0x10);

        for (let i = 0; i < 0x10; i++) {
            const bubble = new TakoHeiInk(dynamicSpawnZoneAndLayer, sceneObjHolder, null);
            this.registerActor(bubble);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        TakoHeiInk.requestArchives(sceneObjHolder);
    }
}

function calcPositionUpOffset(dst: vec3, actor: LiveActor, offset: number): void {
    calcUpVec(dst, actor);
    vec3.scaleAndAdd(dst, actor.translation, dst, offset);
}

function spurtTakoHeiInk(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, velocity: ReadonlyVec3): boolean {
    const actor = sceneObjHolder.takoHeiInkHolder!.getDeadActor();
    if (actor === null)
        return false;

    actor.start(sceneObjHolder, pos, velocity, false);
    return true;
}

const enum TakoHeiNrv { Wait, Walk, FindTurn, Find, Pursue, AttackSign, Attack, CoolDown, NonActive, }
export class TakoHei extends LiveActor<TakoHeiNrv> {
    private origTranslation = vec3.create();
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private targetPos = vec3.create();
    private pushTimer = 0;
    private hasMoveLimitCollision = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'TakoHei');

        sceneObjHolder.create(SceneObj.TakoHeiInkHolder);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'TakoHei');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.calcGravityFlag = true;
        vec3.copy(this.origTranslation, this.translation);
        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);
        // addToAttributeGroupSearchTurtle(this);
        this.initBinder(this.scale[1] * 90.0, this.scale[1] * 90.0, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // this.initSound();

        // initSensor
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, this.scale[0] * 70.0, 0.0);
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, this.scale[0] * 80.0, scratchVec3a);
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, this.scale[0] * 80.0, scratchVec3a);
        // this.initStarPointerTarget();

        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        this.initNerve(TakoHeiNrv.Wait);
        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);

        this.makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        turnQuatUpToGravity(this.poseQuat, this.poseQuat, this);
        this.hasMoveLimitCollision = trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (isSensorEnemyAttack(thisSensor)) {
            // Attack player
        } else {
            if (isSensorEnemy(otherSensor)) {
                const pushed = sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
                if (pushed && this.isPushMovable()) {
                    calcSensorDirectionNormalize(scratchVec3a, otherSensor, thisSensor);
                    const dot = vec3.dot(scratchVec3a, this.velocity);
                    if (dot < 0.0)
                        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, -dot);
                }
            }
        }
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (otherSensor === null || !isSensorEnemy(otherSensor))
                return false;

            if (!this.isPushMovable())
                return false;

            startBtp(this, 'BlinkTwice');
            calcSensorDirectionNormalize(scratchVec3a, otherSensor, thisSensor!);
            const speed = isSensorPlayer(otherSensor) ? 12.0 : 5.0;
            vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, speed);
            this.pushTimer = isSensorPlayer(otherSensor) ? 60 : 20;
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (!this.isNerve(TakoHeiNrv.NonActive)) {
            if (this.pushTimer > 0)
                this.pushTimer--;

            this.updatePose();
            // this.tryPressed();
        }
    }

    private isPushMovable(): boolean {
        // if (this.pushTimer > 0)
        //     return false;

        return true;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TakoHeiNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TakoHeiNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                startBtp(this, 'Open');
            }

            this.updateBlink();
            this.updateNormalVelocity();

            if (this.tryPointBind(sceneObjHolder))
                return;
            if (this.tryFindTurn(sceneObjHolder))
                return;
            if (this.tryWalk(sceneObjHolder))
                return;
            if (this.tryNonActive(sceneObjHolder))
                return;
            } else if (currentNerve === TakoHeiNrv.FindTurn) {
                if (isFirstStep(this)) {
                    startBck(this, 'Turn');
                    startBtp(this, 'Open');
                }
    
                if (this.pushTimer === 1)
                    startBtp(this, 'Open');
    
                getPlayerPos(scratchVec3a, sceneObjHolder);
                turnDirectionToTargetDegree(this.axisZ, this, scratchVec3a, 6.0);
                this.updateNormalVelocity();
    
                if (this.tryPointBind(sceneObjHolder))
                    return;
                if (this.tryFind(sceneObjHolder))
                    return;
        } else if (currentNerve === TakoHeiNrv.Find) {
            if (isFirstStep(this)) {
                startBck(this, 'Search');
                startBtp(this, 'Search');
            }

            this.updateNormalVelocity();

            if (this.tryPointBind(sceneObjHolder))
                return;
            if (this.tryPursue(sceneObjHolder))
                return;
        } else if (currentNerve === TakoHeiNrv.Pursue) {
            if (isFirstStep(this)) {
                startBck(this, 'Run');
                startBtp(this, 'Blink');
            }

            if (this.pushTimer === 1)
                startBtp(this, 'Blink');

            getPlayerPos(scratchVec3a, sceneObjHolder);
            const nearPlayer = isNearPlayer(sceneObjHolder, this, 700.0);
            if (nearPlayer) {
                addVelocityAwayFromTarget(this, scratchVec3a, 0.5);
            } else {
                addVelocityMoveToTarget(this, scratchVec3a, 0.5);
            }

            turnDirectionToTargetDegree(this.axisZ, this, scratchVec3a, 6.0);
            this.updateNormalVelocity();

            if (!nearPlayer) {
                calcPositionUpOffset(scratchVec3a, this, 40.0);
                vec3.scale(scratchVec3b, this.axisZ, 140.0);
                if (isExistMapCollision(sceneObjHolder, scratchVec3a, scratchVec3b)) {
                    this.setNerve(TakoHeiNrv.AttackSign);
                    return;
                }
            }

            if (this.tryAttack(sceneObjHolder))
                return;
            if (this.tryPointBind(sceneObjHolder))
                return;
            if (this.tryPursueEnd(sceneObjHolder))
                return;
        } else if (currentNerve === TakoHeiNrv.AttackSign) {
            if (isFirstStep(this)) {
                startBck(this, 'ShotStart');
                startBtp(this, 'Angry');
            }

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTargetDegree(this.axisZ, this, scratchVec3a, 8.0);
            calcPositionUpOffset(scratchVec3a, this, 40.0);
            vec3.scale(scratchVec3b, this.axisZ, 140.0);
            if (isExistMapCollision(sceneObjHolder, scratchVec3a, scratchVec3b))
                vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, -0.1);
            this.updateNormalVelocity();
            if (this.tryPointBind(sceneObjHolder))
                return;
            if (isBckStopped(this))
                this.setNerve(TakoHeiNrv.Attack);
        } else if (currentNerve === TakoHeiNrv.Attack) {
            if (isFirstStep(this)) {
                const mouthMtx = getJointMtxByName(this, 'Mouth')!;
                vec3.set(scratchVec3a, 0.0, 20.0, 0.0);
                transformVec3Mat4w1(scratchVec3a, mouthMtx, scratchVec3a);
                vec3.scale(scratchVec3b, this.gravityVector, -15.0);
                vec3.scaleAndAdd(scratchVec3b, scratchVec3b, this.axisZ, 20.0);
                spurtTakoHeiInk(sceneObjHolder, scratchVec3a, scratchVec3b);
                startBck(this, 'Shot');
            }

            this.updateNormalVelocity();
            if (this.tryPointBind(sceneObjHolder))
                return;
            if (isBckStopped(this))
                this.setNerve(TakoHeiNrv.Wait);
        } else if (currentNerve === TakoHeiNrv.CoolDown) {
            if (isFirstStep(this)) {
                startBck(this, 'CoolDown');
                startBtp(this, 'Cry');
            }

            if (this.pushTimer === 1)
                startBtp(this, 'Cry');

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTargetDegree(this.axisZ, this, this.axisZ, 0.0);
            this.updateNormalVelocity();
            if (this.tryPointBind(sceneObjHolder))
                return;
            if (this.tryCoolDownEnd(sceneObjHolder))
                return;
        } else if (currentNerve === TakoHeiNrv.Walk) {
            if (isFirstStep(this)) {
                startBck(this, 'Walk');
                startBtp(this, 'Open');
                this.decideNextTargetPos();
            }

            this.updateBlink();
            turnDirectionToTargetDegree(this.axisZ, this, this.targetPos, 6.0);
            if (isGreaterStep(this, 10))
                addVelocityMoveToTarget(this, this.targetPos, 0.2);
            this.updateNormalVelocity();

            if (this.tryPointBind(sceneObjHolder))
                return;
            if (this.tryFindTurn(sceneObjHolder))
                return;
            if (this.tryWalkEnd(sceneObjHolder))
                return;
        } else if (currentNerve === TakoHeiNrv.NonActive) {
            if (isFirstStep(this)) {
                startBtp(this, 'Open');
                this.updatePose();
                this.calcBinderFlag = false;
                offCalcShadow(this);
                this.calcGravityFlag = false;
            }
            vec3.zero(this.velocity);
            if (this.tryActive(sceneObjHolder)) {
                this.calcBinderFlag = true;
                onCalcShadow(this);
                this.calcGravityFlag = true;
                validateHitSensors(this);
            }
        }
    }

    private updateBlink(): void {
        if (this.pushTimer === 1)
            startBtp(this, 'Open');
        if (this.getNerveStep() % 60 === 59)
            startBtp(this, 'Blink');
    }

    private decideNextTargetPos(): void {
        getRandomVector(this.targetPos, 500.0);
        vecKillElement(this.targetPos, this.targetPos, this.gravityVector);
        vec3.add(this.targetPos, this.targetPos, this.origTranslation);
    }

    private isInSightMario(sceneObjHolder: SceneObjHolder): boolean {
        return isInSightFanPlayer(sceneObjHolder, this, this.axisZ, 1600.0, 90.0, 30.0);
    }

    private tryPointBind(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryFindTurn(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isInSightMario(sceneObjHolder)) {
            this.setNerve(TakoHeiNrv.FindTurn);
            return true;
        } else {
            return false;
        }
    }

    private tryFind(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 20)) {
            this.setNerve(TakoHeiNrv.Find);
            return true;
        } else {
            return false;
        }
    }

    private tryPursue(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 30)) {
            this.setNerve(TakoHeiNrv.Pursue);
            return true;
        } else {
            return false;
        }
    }

    private tryAttack(sceneObjHolder: SceneObjHolder): boolean {
        const dist = calcDistanceToPlayer(sceneObjHolder, this);
        if (dist < 650.0)
            return false;
        if (dist > 750.0 && !isGreaterStep(this, 250))
            return false;
        this.setNerve(TakoHeiNrv.AttackSign);
        return true;
    }

    private tryPursueEnd(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 300)) {
            this.setNerve(TakoHeiNrv.CoolDown);
            return true;
        } else if (this.isFallNextMove(sceneObjHolder)) {
            vec3.zero(this.velocity);
            this.setNerve(TakoHeiNrv.Wait);
            return true;
        } else {
            return false;
        }
    }

    private tryCoolDownEnd(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 60)) {
            if (this.isInSightMario(sceneObjHolder))
                this.setNerve(TakoHeiNrv.Pursue);
            else
                this.setNerve(TakoHeiNrv.Wait);
            return true;
        } else {
            return false;
        }
    }

    private tryWalk(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 120)) {
            this.setNerve(TakoHeiNrv.Walk);
            return true;
        } else {
            return false;
        }
    }

    private isFallNextMove(sceneObjHolder: SceneObjHolder): boolean {
        if (this.hasMoveLimitCollision)
            return false;

        if (!isOnGround(this))
            return false;

        return isFallNextMove(sceneObjHolder, this.translation, this.velocity, this.gravityVector, 150.0, this.scale[0] * 90.0 + 2.0, 150.0);
    }

    private tryWalkEnd(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterStep(this, 120)) {
            this.setNerve(TakoHeiNrv.Walk);
            return true;
        }

        vec3.sub(scratchVec3a, this.targetPos, this.translation);
        vecKillElement(scratchVec3a, scratchVec3a, this.gravityVector);
        if (vec3.squaredLength(scratchVec3a) >= 20.0**2 && this.isFallNextMove(sceneObjHolder)) {
            vec3.zero(this.velocity);
            this.setNerve(TakoHeiNrv.Wait);
            return true;
        }

        return false;
    }

    private tryNonActive(sceneObjHolder: SceneObjHolder): boolean {
        if (!isNearPlayerAnyTime(sceneObjHolder, this, 3000.0) && isBindedGround(this)) {
            vec3.zero(this.velocity);
            invalidateHitSensors(this);
            this.setNerve(TakoHeiNrv.NonActive);
            return true;
        } else {
            return false;
        }
    }

    private tryActive(sceneObjHolder: SceneObjHolder): boolean {
        if (isNearPlayerAnyTime(sceneObjHolder, this, 3000.0)) {
            this.setNerve(TakoHeiNrv.Wait);
            return true;
        } else {
            return false;
        }
    }

    private updateNormalVelocity(): void {
        if (isBindedGround(this)) {
            attenuateVelocity(this, 0.85);
        } else {
            addVelocityToGravity(this, 1.5);
            attenuateVelocity(this, 0.99);
        }

        reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);
    }

    private updatePose(): void {
        if (isBindedGround(this)) {
            blendQuatUpFront(this.poseQuat, this.poseQuat, getGroundNormal(this), this.axisZ, 0.1, 0.2);
        } else {
            vec3.negate(scratchVec3a, this.gravityVector);
            blendQuatUpFront(this.poseQuat, this.poseQuat, scratchVec3a, this.axisZ, 0.1, 0.2);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        TakoHeiInkHolder.requestArchives(sceneObjHolder);
    }
}

function isInDarkMatter(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3): boolean {
    // if (isInAreaObj(sceneObjHolder, 'DarkMatterCube', pos))
    //     return true;
    // if (isInAreaObj(sceneObjHolder, 'DarkMatterCylinder', pos))
    //     return true;
    return false;
}

interface ActorMoveParam {
    moveSpeed: number;
    gravitySpeed: number;
    velDamp: number;
    turnSpeed: number;
}

const enum MetboNrv { Wait, WalkAround, Search, ChaseStart, Chase, Rest, NonActive, }
export class Metbo extends LiveActor<MetboNrv> {
    private origTranslation = vec3.create();
    private axisZ = vec3.create();
    private walkAroundDir = vec3.create();

    private static dontMoveParam: ActorMoveParam = {
        moveSpeed: 0.0,
        gravitySpeed: 2.0,
        velDamp: 0.5,
        turnSpeed: 0.0,
    };

    private static searchParam: ActorMoveParam = {
        moveSpeed: 0.0,
        gravitySpeed: 2.0,
        velDamp: 0.5,
        turnSpeed: 5.0,
    };

    private static chaseParam: ActorMoveParam = {
        moveSpeed: 0.8,
        gravitySpeed: 2.0,
        velDamp: 0.9,
        turnSpeed: 2.0,
    };

    private static walkAroundParam: ActorMoveParam = {
        moveSpeed: 0.25,
        gravitySpeed: 2.0,
        velDamp: 0.92,
        turnSpeed: 2.0,
    };

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Metbo');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Metbo');
        connectToSceneEnemy(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 100.0, Vec3Zero);
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 80.0, Vec3Zero);
        this.initBinder(100.0, 100.0, 0);
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        // addHitEffectNormal(this, null);
        initShadowVolumeSphere(sceneObjHolder, this, 80.0);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.calcGravityFlag = true;
        declareCoin(sceneObjHolder, this, 1);
        declareStarPiece(sceneObjHolder, this, 3);
        calcFrontVec(this.axisZ, this);
        vec3.copy(this.origTranslation, this.translation);
        this.initNerve(MetboNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        calcMtxFromGravityAndZAxis(scratchMatrix, this, this.gravityVector, this.axisZ);
        const dst = this.modelInstance!.modelMatrix;
        blendMtx(dst, dst, scratchMatrix, 0.3);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (isInDeath(sceneObjHolder, this.translation) || isInDarkMatter(sceneObjHolder, this.translation) || isInWater(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return;
        }

        restrictVelocity(this, 30.0);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MetboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MetboNrv.Wait) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            this.moveOrFall(sceneObjHolder, Metbo.dontMoveParam);
            if (isValidSwitchA(this) && !isValidSwitchA(this))
                return;

            if (this.trySearch(sceneObjHolder))
                return;
            if (this.tryNonActive(sceneObjHolder))
                return;
            if (isGreaterEqualStep(this, 150))
                this.setNerve(MetboNrv.WalkAround);
        } else if (currentNerve === MetboNrv.WalkAround) {
            if (isFirstStep(this))
                startBck(this, 'Walk');

            // TODO(jstpierre): Figure this out, it seems to make no sense...

            if (vec3.squaredDistance(this.translation, this.origTranslation) <= 300.0**2 && !isBindedWallOfMoveLimit(this) && !isFallNextMove(sceneObjHolder, this.translation, this.axisZ, this.gravityVector, 200.0, 100.0, 300.0)) {
                calcUpVec(scratchVec3a, this);
                const sign = getRandomInt(0, 2) === 0 ? 1.0 : -1.0;
                rotateVecDegree(this.walkAroundDir, scratchVec3a, sign * 20.0);
            } else {
                vec3.sub(this.walkAroundDir, this.origTranslation, this.translation);
            }

            vec3.add(scratchVec3a, this.translation, this.walkAroundDir);
            this.moveOrFall(sceneObjHolder, Metbo.walkAroundParam, scratchVec3a);

            if (this.trySearch(sceneObjHolder))
                return;

            if (isGreaterEqualStep(this, 200))
                this.setNerve(getRandomInt(0, 2) === 0 ? MetboNrv.WalkAround : MetboNrv.Wait);
        } else if (currentNerve === MetboNrv.Search) {
            if (isFirstStep(this))
                startBck(this, 'Search');

            this.moveOrFall(sceneObjHolder, Metbo.searchParam);
            if (isBckStopped(this))
                this.setNerve(MetboNrv.ChaseStart);
        } else if (currentNerve === MetboNrv.ChaseStart) {
            if (isFirstStep(this))
                startBck(this, 'RunStart');

            this.moveOrFall(sceneObjHolder, Metbo.dontMoveParam);
            if (isBckStopped(this))
                this.setNerve(MetboNrv.Chase);
        } else if (currentNerve === MetboNrv.Chase) {
            if (isFirstStep(this))
                startBck(this, 'Run');

            this.moveOrFall(sceneObjHolder, Metbo.chaseParam);
            if (isFallNextMove(sceneObjHolder, this.translation, this.axisZ, this.gravityVector, 200.0, 100.0, 300.0)) {
                this.setNerve(MetboNrv.Rest);
                return;
            }

            if (isGreaterEqualStep(this, 120))
                if (isNearPlayer(sceneObjHolder, this, 1200.0) || isBindedWallOfMoveLimit(this) || isGreaterEqualStep(this, 50) || getRandomInt(0, 50) === 0)
                    this.setNerve(MetboNrv.Rest);
        } else if (currentNerve === MetboNrv.Rest) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            this.moveOrFall(sceneObjHolder, Metbo.dontMoveParam);
            if (isGreaterEqualStep(this, 50))
                this.setNerve(MetboNrv.Wait);
        } else if (currentNerve === MetboNrv.NonActive) {
            if (isFirstStep(this)) {
                vec3.zero(this.velocity);
                this.calcBinderFlag = false;
                offCalcShadow(this);
                this.calcGravityFlag = false;
                this.calcAnimFlag = false;
                invalidateHitSensors(this);
            }

            if (isNearPlayerAnyTime(sceneObjHolder, this, 3000.0)) {
                this.calcBinderFlag = true;
                onCalcShadow(this);
                this.calcGravityFlag = true;
                this.calcAnimFlag = true;
                validateHitSensors(this);

                this.setNerve(MetboNrv.Wait);
            }
        }
    }

    private trySearch(sceneObjHolder: SceneObjHolder): boolean {
        if (!isNearPlayerAnyTime(sceneObjHolder, this, 800.0))
            return false;

        getPlayerPos(scratchVec3a, sceneObjHolder);
        const p0 = this.getSensor('body')!.center;
        vec3.sub(scratchVec3a, scratchVec3a, p0);
        if (isExistMapCollision(sceneObjHolder, p0, scratchVec3a))
            return false;

        if (isExistMoveLimitCollision(sceneObjHolder, p0, scratchVec3a))
            return false;

        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);
        if (isFallNextMove(sceneObjHolder, this.translation, scratchVec3a, this.gravityVector, 200.0, 100.0, 300.0))
            return false;

        this.setNerve(MetboNrv.Search);
        return true;
    }

    private tryNonActive(sceneObjHolder: SceneObjHolder): boolean {
        if (!isNearPlayerAnyTime(sceneObjHolder, this, 3000.0) && isBindedGround(this)) {
            this.setNerve(MetboNrv.NonActive);
            return true;
        } else {
            return false;
        }
    }

    private moveOrFall(sceneObjHolder: SceneObjHolder, moveParam: ActorMoveParam, targetPos: ReadonlyVec3 | null = null): void {
        if (targetPos === null) {
            getPlayerPos(scratchVec3a, sceneObjHolder);
            targetPos = scratchVec3a;
        }
    
        if (isBindedGround(this)) {
            moveAndTurnFrontToTarget(this, this.axisZ, targetPos, moveParam.moveSpeed, moveParam.gravitySpeed, moveParam.velDamp, moveParam.turnSpeed);
        } else {
            moveAndTurnFrontToTarget(this, this.axisZ, targetPos, 0.0, 3.0, 0.99, 0.0);
        }
    }

    public override attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (!isSensorPlayer(otherSensor) && isSensorEnemy(thisSensor))
            sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
    }

    public override receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (otherSensor === null || (!isSensorEnemy(otherSensor) && !isSensorEnemy(otherSensor)))
                return false;

            vec3.sub(scratchVec3a, this.translation, otherSensor.actor.translation);
            vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, 1.5);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }
}

const enum MogucchiNrv { Stroll, Scatter, Die }
export class Mogucchi extends LiveActor<MogucchiNrv> {
    private maxStrollSpeed: number;
    private strollSpeed: number;
    private gravityStrikeVec = vec3.create();
    private isOnGround: boolean = false;
    private referenceMtx = mat4.create();

    private hole: ModelObj;
    private hill: MogucchiHill;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Mogucchi');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.maxStrollSpeed = fallback(getJMapInfoArg0(infoIter), 5.0);
        this.initModelManagerWithAnm(sceneObjHolder, 'Mogucchi');
        connectToSceneEnemy(sceneObjHolder, this);
        // this.initSensor();
        this.initEffectKeeper(sceneObjHolder, null);

        // addEffect(this, 'PointerTouchManual'); and related jazz
        // initSound();
        this.initRailRider(sceneObjHolder, infoIter);
        // declareCoin(this, 1);
        this.initNerve(MogucchiNrv.Stroll);

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        // initStarPointerTargetAtJoint

        this.createMogucchiHill(zoneAndLayer, sceneObjHolder);
        this.createHole(zoneAndLayer, sceneObjHolder);

        startBck(this, 'Walk');
        startBtp(this, 'EyeOpen');
        // this.calcAnim(sceneObjHolder, viewerInput);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (this.getCurrentNerve() !== MogucchiNrv.Scatter && this.getCurrentNerve() !== MogucchiNrv.Die)
            this.updateReferenceMtx();
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MogucchiNrv.Stroll) {
            if (isFirstStep(this)) {
                startBck(this, 'Walk');
                startBtp(this, 'EyeOpen');
                startBck(this.hole, 'Walk');
                this.hill.start(sceneObjHolder);

                this.strollSpeed = this.maxStrollSpeed;
            }

            this.strollSpeed = Math.min(this.strollSpeed + 0.1, this.maxStrollSpeed);
            moveCoord(this, this.strollSpeed * deltaTimeFrames);

            getRailPos(scratchVec3a, this);
            calcGravityVector(sceneObjHolder, this, scratchVec3a, this.gravityStrikeVec, null);
            this.updatePosition(sceneObjHolder);
            this.makeEulerRotation();

            // if (checkHipDrop()) ...
        }
    }

    private makeEulerRotation(): void {
        getRailDirection(scratchVec3a, this);
        vec3.negate(scratchVec3b, this.gravityStrikeVec);
        makeMtxUpFront(scratchMatrix, scratchVec3b, scratchVec3a);
        computeEulerAngleRotationFromSRTMatrix(this.rotation, scratchMatrix);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        showModel(this);
        this.setNerve(MogucchiNrv.Stroll);
        this.hole.makeActorAppeared(sceneObjHolder);
        showModel(this.hole);
        // validateClipping(this);
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);

        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);

        this.setNerve(MogucchiNrv.Die);

        if (!isDead(this.hole))
           this.hole.makeActorDead(sceneObjHolder);
    }

    private createMogucchiHill(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        const pieceCount = Math.min(getRailTotalLength(this), 20);
        this.hill = new MogucchiHill(zoneAndLayer, sceneObjHolder, this, pieceCount);

        if (pieceCount > 5)
            this.hill.appearNum = pieceCount - 5;

        this.hill.reserveAppearDist = 80.0;
        this.hill.reserveSaveDist = 100.0;
    }

    private createHole(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        this.hole = new ModelObj(zoneAndLayer, sceneObjHolder, 'MogucchiHole', 'MogucchiHole', this.referenceMtx, DrawBufferType.MapObjStrongLight, -2, -2);
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        moveCoordToNearestPos(this);
        getRailPos(scratchVec3a, this);
        calcGravityVector(sceneObjHolder, this, scratchVec3a, this.gravityStrikeVec);
        this.updatePosition(sceneObjHolder);
        this.updateReferenceMtx();
    }

    private updatePosition(sceneObjHolder: SceneObjHolder): void {
        getRailPos(scratchVec3a, this);
        vec3.scale(scratchVec3b, this.gravityStrikeVec, 1000.0);

        this.isOnGround = getFirstPolyOnLineToMap(sceneObjHolder, this.translation, null, scratchVec3a, scratchVec3b);

        if (!this.isOnGround)
            vec3.copy(this.translation, scratchVec3a);
    }

    private updateReferenceMtx(): void {
        makeMtxTRFromActor(this.referenceMtx, this);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('MogucchiHole');
        MogucchiHill.requestArchives(sceneObjHolder);
    }
}

const enum MogucchiHillNrv { Wait, Move }
class MogucchiHill extends LiveActor<MogucchiHillNrv> {
    private static pieceModelNames: string[] = [
        'MogucchiHillA',
        'MogucchiHillB',
        'MogucchiHillC',
    ];
    private pieceJointName: string = 'MogucchiHill';
    private pieceEffectName: string = 'MogucchiHill';
    private pieceUseLightCtrl: boolean = false;

    private pieces: MogucchiHillPiece[] = [];
    private pieceCanAppear: boolean = false;
    private nextAppearPiece: number = 0;
    private mode: number = 0;
    private pieceScaleTimer: number = 0;

    private reserveMtx = mat4.create();
    public appearNum: number = 0;
    public reserveAppearDist: number = 100.0;
    public reserveSaveDist: number = 150.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private parentActor: LiveActor, private pieceCount: number) {
        super(zoneAndLayer, sceneObjHolder, 'MogucchiHill');

        this.pieceCount = Math.min(this.pieceCount, 100);
        this.appearNum = this.pieceCount;

        connectToSceneEnemyMovement(sceneObjHolder, this);
        this.initNerve(MogucchiHillNrv.Move);
        this.createPieces(zoneAndLayer, sceneObjHolder);
        this.makeActorDead(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiHillNrv, deltaTimeFrames: number): void {
        if (currentNerve === MogucchiHillNrv.Move) {
            if (isFirstStep(this))
                this.reserveCurrentMtx();

            const distance = this.getDistanceFromReserveMtx();
            if (this.pieceCanAppear && distance >= this.reserveAppearDist)
                this.appearPiece(sceneObjHolder);
            if (distance >= this.reserveSaveDist)
                this.reserveCurrentMtx();
        }
    }

    private appearPiece(sceneObjHolder: SceneObjHolder): void {
        this.killPieceOverAppear(sceneObjHolder);
        this.killPieceIfAlive(sceneObjHolder);

        if (this.mode === 1) {
            this.pieceScaleTimer++;

            if (this.pieceScaleTimer > 2) {
                this.pieceScaleTimer = 3;
                this.mode = 0;
            }
        } else if (this.mode === 2) {
            this.pieceScaleTimer--;
            if (this.pieceScaleTimer < 1) {
                this.pieceScaleTimer = 0;
                this.mode = 0;
                return;
            }
        }

        if (this.pieceScaleTimer !== 0) {
            const piece = this.pieces[this.nextAppearPiece];
            const scale = this.scale[0] * (0.6 + 0.4 * ((this.pieceScaleTimer - 1) * 0.5));
            piece.setSize(scale);

            mat4.copy(piece.baseMtx, this.reserveMtx);
            getMatrixTranslation(piece.translation, piece.baseMtx);
            piece.makeActorAppeared(sceneObjHolder);
            this.pieceCanAppear = false;

            this.nextAppearPiece = (this.nextAppearPiece + 1) % this.pieceCount;
        }
    }

    public start(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            this.makeActorAppeared(sceneObjHolder);

        this.setNerve(MogucchiHillNrv.Move);
        this.pieceScaleTimer = 3;
    }

    public startNaturally(sceneObjHolder: SceneObjHolder): void {
        this.mode = 1;
        this.start(sceneObjHolder);
    }

    public end(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(MogucchiHillNrv.Wait);
    }

    public endNaturally(sceneObjHolder: SceneObjHolder): void {
        this.mode = 2;
        this.end(sceneObjHolder);
    }

    private killPieceOverAppear(sceneObjHolder: SceneObjHolder): void {
        const idx = (this.nextAppearPiece + this.pieceCount - this.appearNum) % this.pieceCount;
        this.pieces[idx].crumble(sceneObjHolder);
    }

    private killPieceIfAlive(sceneObjHolder: SceneObjHolder): void {
        const nextPiece = this.pieces[this.nextAppearPiece];
        if (!isDead(nextPiece))
            nextPiece.makeActorDead(sceneObjHolder);
    }

    private getDistanceFromReserveMtx(): number {
        getMatrixTranslation(scratchVec3a, this.reserveMtx);
        return vec3.distance(this.parentActor.translation, scratchVec3a);
    }

    private reserveCurrentMtx(): void {
        mat4.copy(this.reserveMtx, this.parentActor.getBaseMtx()!);
        this.pieceCanAppear = true;
    }

    private createPieces(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        const pieceModelNames = MogucchiHill.pieceModelNames;

        for (let i = 0; i < this.pieceCount; i++) {
            const idx = getRandomInt(0, pieceModelNames.length - 1);
            const pieceModelName = pieceModelNames[idx];

            const piece = new MogucchiHillPiece(zoneAndLayer, sceneObjHolder, pieceModelName, this.pieceJointName, this.pieceEffectName, this.pieceUseLightCtrl);
            this.pieces.push(piece);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.pieceModelNames.length; i++)
            sceneObjHolder.modelCache.requestObjectData(this.pieceModelNames[i]);
    }
}

const enum MogucchiHillPieceNrv { Wait, Appear, Crumble }
class MogucchiHillPiece extends LiveActor<MogucchiHillPieceNrv> {
    public baseMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, modelName: string, jointName: string, effectName: string | null, useLightCtrl: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'MogucchiHillPiece');

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneMapObjDecorationStrongLight(sceneObjHolder, this);
        // this.initHitSensor();
        // addHitSensorAtJointMapObj

        if (effectName !== null)
            this.initEffectKeeper(sceneObjHolder, effectName);

        if (useLightCtrl)
        initLightCtrl(sceneObjHolder, this);

        // initSound
        this.initNerve(MogucchiHillPieceNrv.Wait);
        this.makeActorDead(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiHillPieceNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MogucchiHillPieceNrv.Wait) {
            // Nothing.
        } else if (currentNerve === MogucchiHillPieceNrv.Appear) {
            if (isFirstStep(this)) {
                showModel(this);
                startBck(this, 'Lead');
                startBrk(this, 'Normal');
                // startSound
            }

            if (isBckStopped(this))
                this.setNerve(MogucchiHillPieceNrv.Wait);
        } else if (currentNerve === MogucchiHillPieceNrv.Crumble) {
            if (isFirstStep(this)) {
                startBck(this, 'Fade');
                startBrk(this, 'Fade');
            }

            if (isBckStopped(this))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public crumble(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            return;

        // TODO(jstpierre): If clipped, immediately destroy
        // if (isClipped(this)) {
        //    this.makeActorDead(sceneObjHolder);
        //    return;
        // }

        if (this.getCurrentNerve() !== MogucchiHillPieceNrv.Crumble)
            this.setNerve(MogucchiHillPieceNrv.Crumble);
    }

    public destroyHillPiece(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'Break');
        this.makeActorDead(sceneObjHolder);
    }

    public setSize(size: number): void {
        vec3SetAll(this.scale, size);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        mat4.copy(this.modelInstance!.modelMatrix, this.baseMtx);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(MogucchiHillPieceNrv.Appear);
        hideModel(this);
    }
}

class SkeletalFishRailControl {
    public railActor: LiveActor;
    public speed = 0.0;

    public setRailActor(railActor: LiveActor, reset: boolean): void {
        this.railActor = railActor;
        if (reset) {
            setRailCoord(this.railActor, 0.0);
            setRailDirectionToEnd(this.railActor);
        }
    }

    public getPos(dst: vec3, offset: number = 0.0): void {
        const railCoord = getRailCoord(this.railActor) - offset;

        if (railCoord >= 0.0 || isLoopRail(this.railActor)) {
            calcRailPosAtCoord(dst, this.railActor, railCoord);
        } else {
            throw "whoops";
        }
    }

    public getMtx(dst: mat4, sceneObjHolder: SceneObjHolder, offset: number = 0.0): void {
        const railCoord = getRailCoord(this.railActor) - offset;
        if (railCoord >= 0.0 || isLoopRail(this.railActor)) {
            calcRailPosAtCoord(scratchVec3a, this.railActor, railCoord);
            calcRailDirectionAtCoord(scratchVec3b, this.railActor, railCoord);
        } else {
            throw "whoops";
        }

        vec3.normalize(scratchVec3b, scratchVec3b);
        calcGravityVector(sceneObjHolder, this.railActor, scratchVec3a, scratchVec3c);
        vec3.negate(scratchVec3c, scratchVec3c);
        makeMtxFrontUpPos(dst, scratchVec3b, scratchVec3c, scratchVec3a);
    }

    public update(): void {
        setRailCoordSpeed(this.railActor, this.speed);
        moveRailRider(this.railActor);
    }
}

const enum SkeletalFishBabyNrv { Swim, }
export class SkeletalFishBaby extends LiveActor<SkeletalFishBabyNrv> {
    private maxRailSpeed: number;
    private railSpeed: number;
    private railControl = new SkeletalFishRailControl();
    private railInvMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.AirBubbleHolder);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.maxRailSpeed = fallback(getJMapInfoArg0(infoIter), 20.0);
        this.railSpeed = this.maxRailSpeed;

        this.initModelManagerWithAnm(sceneObjHolder, 'SnakeFish');
        this.initRailRider(sceneObjHolder, infoIter);
        this.railControl.setRailActor(this, true);
        this.railControl.speed = this.railSpeed;
        moveCoordToNearestPos(this);

        this.modelInstance!.jointMatrixCalcCallback = this.jointMatrixCalcCallback.bind(this, sceneObjHolder);
        this.initNerve(SkeletalFishBabyNrv.Swim);

        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        initShadowFromCSV(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        declareStarPiece(sceneObjHolder, this, 10);
        this.calcGravityFlag = true;
    }

    public override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        this.railControl.getMtx(this.modelInstance!.modelMatrix, sceneObjHolder);
        mat4.invert(this.railInvMtx, this.modelInstance!.modelMatrix);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        this.railControl.speed = this.railSpeed * sceneObjHolder.deltaTimeFrames;
        this.railControl.update();
        this.railControl.getPos(this.translation);
        // this.railRider!.debugDrawRailLine(viewerInput.camera);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: SkeletalFishBabyNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === SkeletalFishBabyNrv.Swim) {
            if (isFirstStep(this)) {
                startBck(this, 'Swim');
            }

            this.railSpeed = Math.min(this.railSpeed + 0.1, this.maxRailSpeed);
        }
    }

    private calcJoint(dst: mat4, sceneObjHolder: SceneObjHolder, parentJointToWorldMatrix: ReadonlyMat4): void {
        // Original code takes a matrix in world-space, and returns a matrix in world space.
        // We take a matrix in parent-space, and return a matrix in parent-space.
        // There's probably a smarter way to do this...

        // Convert to world space.
        mat4.mul(dst, parentJointToWorldMatrix, dst);

        mat4.mul(dst, this.railInvMtx, dst);
        const z = -dst[14];
        computeModelMatrixT(scratchMatrix, 0.0, 0.0, z);
        mat4.mul(dst, scratchMatrix, dst);
        this.railControl.getMtx(scratchMatrix, sceneObjHolder, z);
        mat4.mul(dst, scratchMatrix, dst);

        // Convert to parent space.
        mat4.invert(scratchMatrix, parentJointToWorldMatrix);
        mat4.mul(dst, scratchMatrix, dst);
    }

    private jointMatrixCalcCallback(sceneObjHolder: SceneObjHolder, dst: mat4, modelData: J3DModelData, i: number, parentJointToWorldMatrix: ReadonlyMat4): void {
        const jointName = modelData.bmd.jnt1.joints[i].name;
        if (jointName === 'Joint01' || jointName === 'Joint02' || jointName === 'Joint03' || jointName === 'Joint04') {
            this.calcJoint(dst, sceneObjHolder, parentJointToWorldMatrix);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('SnakeFish');
    }
}

function createNoItemKuriboActor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): Kuribo {
    const kuribo = new Kuribo(zoneAndLayer, sceneObjHolder, infoIter);
    kuribo.generateItem = false;
    return kuribo;
}

export class ExterminationChecker extends LiveActor {
    private group: LiveActorGroup<LiveActor>;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToSceneMapObjMovement(sceneObjHolder, this);

        this.group = new LiveActorGroup<LiveActor>(sceneObjHolder, 'ExterminationCheckerGroup', 16);

        iterChildObj(sceneObjHolder, infoIter, (childInfoIter) => {
            const createActor = (childInfoIter: JMapInfoIter) => {
                const childObjName = getObjectName(childInfoIter);
                if (childObjName === 'ChildKuribo')
                    return createNoItemKuriboActor(zoneAndLayer, sceneObjHolder, childInfoIter);
                else if (childObjName === 'ChildSkeletalFishBaby')
                    return new SkeletalFishBaby(zoneAndLayer, sceneObjHolder, childInfoIter);
                else if (childObjName === 'ChildMeramera')
                    throw "whoops";
                else
                    throw "whoops";
            };

            const actor = createActor(childInfoIter);
            this.group.registerActor(actor);
        });

        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        // KeySwitch
        // PowerStarAppear

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const objectName = getObjectName(infoIter);
        if (objectName === 'ExterminationSkeletalFishBaby')
            SkeletalFishBaby.requestArchives(sceneObjHolder, infoIter);
    }
}

class ValueControl {
    private curFrame = 0;
    private dir = 1;

    constructor(private maxFrame: number) {
    }

    public getValue(): number {
        return this.curFrame / this.maxFrame;
    }

    public setMaxFrame(newMaxFrame: number): void {
        this.curFrame = this.getValue() * newMaxFrame;
        this.maxFrame = newMaxFrame;
    }

    public resetFrame(): void {
        this.curFrame = this.dir > 0 ? 0 : this.maxFrame;
    }

    public setDirToOne(): void {
        this.dir = 1;
    }

    public setDirToOneResetFrame(): void {
        this.setDirToOne();
        this.resetFrame();
    }

    public isMaxFrame(): boolean {
        return this.curFrame === this.maxFrame;
    }

    public update(deltaTimeFrames: number): void {
        this.curFrame += deltaTimeFrames * this.dir;
        this.curFrame = clamp(this.curFrame, 0, this.maxFrame);
    }
}

function moveCoordAndTransToNextPoint(actor: LiveActor): void {
    moveCoordAndTransToRailPoint(actor, getNextRailPointNo(actor));
}

const enum PukupukuStateLandingNrv { MoveLand, JumpFromLand, JumpFromWater, }
class PukupukuStateLanding extends ActorStateBaseInterface<PukupukuStateLandingNrv> {
    private valueControl = new ValueControl(30);
    private parabolicPath = new ParabolicPath();
    private hasWaterColumn = false;

    constructor(private host: Pukupuku) {
        super();
        this.initNerve(PukupukuStateLandingNrv.MoveLand);
        this.kill();
    }

    private setupJumping(height: number, averageSpeed: number): void {
        calcRailPointPos(scratchVec3a, this.host, getCurrentRailPointNo(this.host));
        vec3.sub(scratchVec3a, this.host.translation, scratchVec3a);
        vec3.negate(scratchVec3b, this.host.gravityVector);
        height -= Math.max(0, vec3.dot(scratchVec3a, scratchVec3b));
        calcRailPointPos(scratchVec3c, this.host, getNextRailPointNo(this.host));
        this.parabolicPath.initFromUpVectorAddHeight(this.host.translation, scratchVec3c, scratchVec3b, height);
        const pathSpeed = this.parabolicPath.calcPathSpeedFromAverageSpeed(averageSpeed);
        this.valueControl.setMaxFrame(1.0 / pathSpeed);
        this.valueControl.setDirToOneResetFrame();
    }

    private emitGroundHitEffect(sceneObjHolder: SceneObjHolder): void {
        if (!isBindedGround(this.host)) {
            const triangle = new Triangle();
            vec3.scale(scratchVec3b, this.host.gravityVector, 100.0);
            if (getFirstPolyOnLineToMap(sceneObjHolder, scratchVec3a, triangle, this.host.translation, scratchVec3b)) {
                this.host.effectKeeper!.updateFloorCodeTriangle(sceneObjHolder, triangle);
            }
        }

        this.host.calcGroundHitMtx(scratchMatrix);
        emitEffectHitMtx(sceneObjHolder, this.host, scratchMatrix, "Land");
    }

    private setNerveAfterJumpAccordingToNextPoint(): void {
        if (this.host.isReadyToJumpFromLand())
            this.setNerve(PukupukuStateLandingNrv.JumpFromLand);
        else
            this.setNerve(PukupukuStateLandingNrv.MoveLand);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PukupukuStateLandingNrv, deltaTimeFrames: number): void {
        if (currentNerve === PukupukuStateLandingNrv.MoveLand) {
            if (isFirstStep(this)) {
                this.setupJumping(300.0, 15.0);
                startBck(this.host, 'Bound');
                startBtp(this.host, 'CloseEye');
                this.emitGroundHitEffect(sceneObjHolder);
            }

            this.valueControl.update(deltaTimeFrames);
            this.updateJumping();
            this.host.updatePoseByRailIgnoreUpScale();

            if (this.valueControl.isMaxFrame() || (this.valueControl.getValue() > 0.5 && isBinded(this.host))) {
                moveCoordToRailPoint(this.host, getNextRailPointNo(this.host));
                if (isBinded(this.host))
                    vec3.zero(this.host.velocity);
                this.setNerveAfterJumpAccordingToNextPoint();
            }
        } else if (currentNerve === PukupukuStateLandingNrv.JumpFromLand) {
            if (isFirstStep(this)) {
                this.hasWaterColumn = false;
                this.setupJumping(500.0, 15.0);
                startBck(this.host, 'FlyEnd');
                startBtp(this.host, 'OpenEye');
                this.emitGroundHitEffect(sceneObjHolder);
            }

            this.valueControl.update(deltaTimeFrames);
            this.updateJumping();
            this.emitWaterColumnIfNeeded(sceneObjHolder, false, false);
            this.updatePoseByJumpPath(0.15);

            if (this.valueControl.isMaxFrame()) {
                moveCoordAndTransToNextPoint(this.host);
                this.emitWaterColumnIfNeeded(sceneObjHolder, false, true);
                this.kill();
            }
        } else if (currentNerve === PukupukuStateLandingNrv.JumpFromWater) {
            if (isFirstStep(this)) {
                this.hasWaterColumn = false;
                this.setupJumping(500.0, 15.0);
                startBck(this.host, 'FlyStart');
                startBtp(this.host, 'OpenEye');
                this.emitGroundHitEffect(sceneObjHolder);
            }

            this.valueControl.update(deltaTimeFrames);
            this.updateJumping();
            this.emitWaterColumnIfNeeded(sceneObjHolder, true, false);
            this.updatePoseByJumpPath(0.15);

            if (this.valueControl.isMaxFrame() || (this.valueControl.getValue() > 0.5 && isBinded(this.host))) {
                moveCoordToRailPoint(this.host, getNextRailPointNo(this.host));
                if (isBinded(this.host))
                    vec3.zero(this.host.velocity);
                this.setNerveAfterJumpAccordingToNextPoint();
            }
        }
    }

    private updatePoseByJumpPath(speed: number): void {
        this.parabolicPath.calcDirection(scratchVec3a, this.valueControl.getValue(), 0.01);
        this.host.updatePoseByJumpPathDirection(scratchVec3a, speed);
    }

    private emitWaterColumnIfNeeded(sceneObjHolder: SceneObjHolder, onLand: boolean, force: boolean): void {
        if (this.hasWaterColumn)
            return;

        const centerMtx = getJointMtxByName(this.host, 'Center')!;
        getMatrixTranslation(scratchVec3a, centerMtx);

        if (!force && isInWater(sceneObjHolder, scratchVec3a) !== onLand)
            return;

        this.host.calcGroundHitMtx(scratchMatrix);
        scaleMatrix(scratchMatrix, scratchMatrix, 1.5);
        setMatrixTranslation(scratchMatrix, scratchVec3a);
        emitEffectHitMtx(sceneObjHolder, this.host, scratchMatrix, 'WaterColumn');
        this.hasWaterColumn = true;
    }

    private updateJumping(): void {
        this.parabolicPath.calcPosition(scratchVec3a, this.valueControl.getValue());
        // this.parabolicPath.debugDraw(window.main.scene.sceneObjHolder!);
        vec3.sub(this.host.velocity, scratchVec3a, this.host.translation);
    }
}

const enum PukupukuNrv { Wait, Landing, MoveWater, MoveWaterAfterJump };
export class Pukupuku extends LiveActor<PukupukuNrv> {
    private binderOffset = vec3.create();
    private poseQuat = quat.create();
    private landingState: PukupukuStateLanding;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Pukupuku');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.calcGravityFlag = true;
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Pukupuku');

        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorAtJoint(sceneObjHolder, this, 'body', "Center", HitSensorType.Pukupuku, 8, 60.0, Vec3Zero);
        this.initBinder(70.0, 0.0, 0);
        setBinderOffsetVec(this, this.binderOffset);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToNearestRailPos(this);

        quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
        this.updatePoseByRail();

        this.initEffectKeeper(sceneObjHolder, null);
        declareCoin(sceneObjHolder, this, 1);
        declareStarPiece(sceneObjHolder, this, 3);
        initShadowVolumeSphere(sceneObjHolder, this, 50.0);
        this.initNerve(PukupukuNrv.Wait);
        this.landingState = new PukupukuStateLanding(this);

        this.makeActorAppeared(sceneObjHolder);
    }

    public calcGroundHitMtx(dst: mat4): void {
        quatGetAxisZ(scratchVec3a, this.poseQuat);
        calcMtxFromGravityAndZAxis(dst, this, this.gravityVector, scratchVec3a);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);
        vec3.scale(this.binderOffset, this.gravityVector, -70.0);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PukupukuNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PukupukuNrv.Wait) {
            if (isInWater(sceneObjHolder, this.translation)) {
                this.setNerve(PukupukuNrv.MoveWater);
            } else {
                this.landingState.appear();
                this.landingState.setNerve(PukupukuStateLandingNrv.MoveLand);
                this.setNerve(PukupukuNrv.Landing);
            }
        } else if (currentNerve === PukupukuNrv.MoveWater) {
            if (isFirstStep(this)) {
                startBck(this, 'Swim');
                startBtp(this, 'OpenEye');
            }

            this.exeMoveWaterCommon(sceneObjHolder, deltaTimeFrames);
        } else if (currentNerve === PukupukuNrv.Landing) {
            this.landingState.update(sceneObjHolder, deltaTimeFrames);
            if (this.landingState.isDead)
                this.setNerve(PukupukuNrv.MoveWaterAfterJump);
        } else if (currentNerve === PukupukuNrv.MoveWaterAfterJump) {
            if (isFirstStep(this)) {
                startBck(this, 'SwimStart');
                startBtp(this, 'OpenEye');
                this.rotatePoseByLocalZ();
            }

            this.updateMoveWaterAfterJump(sceneObjHolder, deltaTimeFrames);
        }
    }

    public isReadyToJumpFromLand(): boolean {
        return getCurrentRailPointArg0(this) === 1;
    }

    private exeMoveWaterCommon(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        moveCoordAndFollowTrans(this, 5.0 * deltaTimeFrames);
        this.updatePoseByRail();

        if (this.isReadyToJumpFromLand()) {
            this.landingState.appear();
            this.landingState.setNerve(PukupukuStateLandingNrv.JumpFromWater);
            this.setNerve(PukupukuNrv.Landing);
        }
    }

    private updateMoveWaterAfterJump(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.exeMoveWaterCommon(sceneObjHolder, deltaTimeFrames);
        if (isBckStopped(this))
            this.setNerve(PukupukuNrv.MoveWater);
    }

    private rotatePoseByLocalZ(): void {
        quat.setAxisAngle(scratchQuat, Vec3UnitZ, Math.PI);
        quat.mul(this.poseQuat, this.poseQuat, scratchQuat);
    }

    public updatePose(front: ReadonlyVec3, up: ReadonlyVec3, speed: number): void {
        if (!isSameDirection(front, up, 0.01)) {
            makeQuatFromVec(scratchQuat, front, up);
            quat.slerp(this.poseQuat, this.poseQuat, scratchQuat, speed);
        }
    }

    private updatePoseByRail(): void {
        getRailDirection(scratchVec3a, this);
        quatGetAxisY(scratchVec3b, this.poseQuat);
        this.updatePose(scratchVec3a, scratchVec3b, 0.08);
    }

    public updatePoseByRailIgnoreUpScale(): void {
        getRailDirection(scratchVec3a, this);
        vec3.negate(scratchVec3b, this.gravityVector);
        this.updatePose(scratchVec3a, scratchVec3b, 0.08);
    }

    public updatePoseByJumpPathDirection(dir: ReadonlyVec3, speed: number): void {
        // vec3.copy(scratchVec3a, dir);
        vec3.negate(scratchVec3b, this.gravityVector);
        this.updatePose(scratchVec3a, scratchVec3b, speed);
    }
}

function turnVecToPlane(dst: vec3, src: ReadonlyVec3, up: ReadonlyVec3): void {
    const length = vec3.len(src);
    vecKillElement(dst, src, up);
    normToLength(dst, length);
}

const enum JellyfishNrv { Wait, Find, WaitWithRightTurn, WaitWithLeftTurn, ThreatWithLeftTurn, ThreatWithRightTurn, Threat, RailGoal, Death, }
export class Jellyfish extends LiveActor<JellyfishNrv> {
    private railSpeed: number;
    private railWaitAtGoal: number;
    private frameCounter = 0;
    private axisZ = vec3.create();
    private shouldWander = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Jellyfish');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Jellyfish');
        connectToSceneEnemy(sceneObjHolder, this);
        // addToAttributeGroupSearchTurtle
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 30.0, 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.KillerTargetEnemy, 8, 100.0, scratchVec3a);
        this.initBinder(130.0, 0.0, 0);
        this.calcBinderFlag = false;
        this.initEffectKeeper(sceneObjHolder, null);
        // addEffectHitNormal
        initShadowVolumeSphere(sceneObjHolder, this, 100.0);
        setShadowDropLength(this, null, 1900.0);
        declareCoin(sceneObjHolder, this, 1);
        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            // initAndSetRailClipping
            moveCoordToNearestPos(this);
        }
        this.railSpeed = fallback(getJMapInfoArg0(infoIter), 5.0);
        this.railWaitAtGoal = fallback(getJMapInfoArg1(infoIter), 60);
        this.shouldWander = getJMapInfoArg2(infoIter) === 1;
        calcFrontVec(this.axisZ, this);
        this.initNerve(JellyfishNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.axisZ);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        // requestPointLight
        if (!this.isNerve(JellyfishNrv.Death)) {
            if (this.railRider !== null) {
                moveCoordAndFollowTrans(this, this.railSpeed);
                if (isRailReachedGoal(this) && !this.isNerve(JellyfishNrv.RailGoal)) {
                    this.setNerve(JellyfishNrv.RailGoal);
                    return;
                }
            }

            const gravityStrength = Math.sin(this.frameCounter + MathConstants.TAU / 8);
            vec3.scale(this.velocity, this.gravityVector, gravityStrength);
            this.frameCounter += sceneObjHolder.deltaTimeFrames;
        }
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: JellyfishNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === JellyfishNrv.Wait) {
            if (isFirstStep(this) && !isBckPlaying(this, "Wait")) {
                startBck(this, "Wait");
                startBrk(this, "Wait");
            }

            this.selectNerveAfterWait(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.WaitWithLeftTurn) {
            rotateVecDegree(this.axisZ, this.gravityVector, -10.0 * deltaTimeFrames);
            this.selectNerveAfterWait(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.WaitWithRightTurn) {
            rotateVecDegree(this.axisZ, this.gravityVector, 10.0 * deltaTimeFrames);
            this.selectNerveAfterWait(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.Find) {
            if (isFirstStep(this)) {
                startBck(this, "SearchOn");
                startBrk(this, "SearchOn");
            }

            this.faceToMario(sceneObjHolder, deltaTimeFrames);
            if (isBckStopped(this))
                this.selectNerveThreat(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.Threat) {
            if (isFirstStep(this)) {
                startBck(this, "SearchWait");
                startBrk(this, "SearchWait");
            }

            this.faceToMario(sceneObjHolder, deltaTimeFrames);
            this.selectNerveThreat(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.ThreatWithLeftTurn || currentNerve === JellyfishNrv.ThreatWithRightTurn) {
            if (isFirstStep(this)) {
                startBck(this, "SearchRotate");
                startBrk(this, "SearchRotate");
            }

            this.faceToMario(sceneObjHolder, deltaTimeFrames);
            if (isBckStopped(this))
                this.selectNerveThreat(sceneObjHolder);
        } else if (currentNerve === JellyfishNrv.RailGoal) {
            if (isGreaterEqualStep(this, this.railWaitAtGoal)) {
                if (this.shouldWander) {
                    moveCoordAndTransToRailStartPoint(this);
                } else {
                    reverseRailDirection(this);
                }

                this.setNerve(JellyfishNrv.Wait);
            }
        }
    }

    private faceToMario(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.subtract(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);

        if (!isNearZeroVec3(scratchVec3a, 0.001)) {
            calcSideVec(scratchVec3b, this);
            const speed = 0.2;
            turnVecToVecCosOnPlane(this.axisZ, this.axisZ, scratchVec3a, scratchVec3b, speed * deltaTimeFrames);
            vec3.negate(scratchVec3a, this.gravityVector);
            turnVecToPlane(scratchVec3a, this.axisZ, scratchVec3a);
            clampVecAngleDeg(this.axisZ, scratchVec3a, 30.0);
        }

        if (!this.isNerve(JellyfishNrv.Threat)) {
            const speed = 1.0 - (this.getNerveStep() / getBckFrameMaxNamed(this, 'SearchRotate'));
            const dir = this.isNerve(JellyfishNrv.ThreatWithLeftTurn) ? 1.0 : -1.0;
            rotateVecDegree(this.axisZ, this.gravityVector, 1.5 * dir * speed * deltaTimeFrames);
        }
    }

    private selectNerveAfterWait(sceneObjHolder: SceneObjHolder): void {
        if (isNearPlayer(sceneObjHolder, this, 1000.0)) {
            this.setNerve(JellyfishNrv.Find);
            return;
        }

        if (this.railRider === null || this.shouldWander) {
            if (isGreaterEqualStep(this, 280)) {
                const rnd = this.isNerve(JellyfishNrv.Wait) ? getRandomInt(0, 3) : 0;
                if (rnd === 0)
                    this.setNerve(JellyfishNrv.Wait);
                else if (rnd === 1)
                    this.setNerve(JellyfishNrv.WaitWithRightTurn);
                else
                    this.setNerve(JellyfishNrv.WaitWithLeftTurn);
            }
        }
    }

    private selectNerveThreat(sceneObjHolder: SceneObjHolder): void {
        if (!isNearPlayer(sceneObjHolder, this, 1500.0)) {
            this.setNerve(JellyfishNrv.Wait);
            return;
        }

        // probably a better way to do this -- more like turnVecToVecCosOnPlane
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.subtract(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);

        turnVecToPlane(scratchVec3b, scratchVec3a, this.gravityVector);
        turnVecToPlane(scratchVec3c, this.axisZ, this.gravityVector);

        const cos = vec3.dot(scratchVec3b, scratchVec3c);
        vec3.cross(scratchVec3a, scratchVec3c, scratchVec3b);
        const sin = vec3.length(scratchVec3a);
        if (Math.atan2(sin, cos) >= 35.0 * MathConstants.DEG_TO_RAD) {
            getPlayerPos(scratchVec3a, sceneObjHolder);
            vec3.subtract(scratchVec3a, scratchVec3a, this.translation);

            calcSideVec(scratchVec3b, this);
            if (vec3.dot(scratchVec3a, scratchVec3b) >= 0.0) {
                this.setNerve(JellyfishNrv.ThreatWithRightTurn);
            } else {
                this.setNerve(JellyfishNrv.ThreatWithLeftTurn);
            }
        } else {
            if (!this.isNerve(JellyfishNrv.Threat))
                this.setNerve(JellyfishNrv.Threat);
        }
    }
}

const enum MerameraEffectHead { None, Wait, Chase, Escape }
const enum MerameraEffectBody { None, Heat, CoolDown, Cold }
const enum MerameraElementType { Fire, Ice, }
const enum MerameraNrv { Wait, Walk, WalkEnd, Float, Runaway, StartDiving, Diving, }
export class Meramera extends LiveActor<MerameraNrv> {
    private elementType: MerameraElementType;
    private effectExtinguishSideMtx = mat4.create();
    private effectMtx = mat4.create();
    private effectFallMtx = mat4.create();
    private effectHead = MerameraEffectHead.None;
    private effectBody = MerameraEffectBody.None;
    private origTranslation = vec3.create();
    private appearType: number;
    private axisZ = vec3.create();
    private poseQuat = quat.create();
    private targetWalkPos = vec3.create();
    private effectUp = vec3.create();
    private distanceToGoal = -1;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        if (this.name === 'Meramera' || this.name === 'ChildMeramera')
            this.elementType = MerameraElementType.Fire;
        else if (this.name === 'IceMeramera' || this.name === 'ChildIceMeramera')
            this.elementType = MerameraElementType.Ice;

        const arcName = ['Meramera', 'IceMeramera'];
        this.initModelManagerWithAnm(sceneObjHolder, arcName[this.elementType]);
        connectToSceneEnemy(sceneObjHolder, this);

        // initSensor()
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, this.scale[0] * 55.0, Vec3Zero);
        addHitSensorEnemy(sceneObjHolder, this, 'break', 8, this.scale[0] * 10.0, Vec3Zero);
        vec3.set(scratchVec3a, 50.0, 0.0, 0.0);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'attack', "JointRoot", 8, this.scale[0] * 70.0, scratchVec3a);
        invalidateHitSensor(this, 'break');

        // initBind()
        this.initBinder(this.scale[0] * 45.0, 0.0, 0);
        this.calcGravityFlag = true;

        // initEffect()
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'ExtinguishSide', this.effectExtinguishSideMtx);
        setEffectHostMtx(this, 'ExtinguishSideLight', this.effectExtinguishSideMtx);
        setEffectHostMtx(this, 'Wait', this.effectMtx);
        setEffectHostMtx(this, 'Escape', this.effectMtx);
        setEffectHostMtx(this, 'ExtinguishSmoke', this.effectMtx);
        setEffectHostMtx(this, 'ChaseStart', this.effectMtx);
        setEffectHostMtx(this, 'Chase', this.effectMtx);
        setEffectHostMtx(this, 'Attack', this.effectMtx);
        setEffectHostMtx(this, 'Fall', this.effectFallMtx);

        // initShadow()
        initShadowController(this);
        addShadowSurfaceCircle(sceneObjHolder, this, "WaterSurface", this.scale[0] * 50.0);
        setShadowDropStartOffset(this, "WaterSurface", 150.0);
        addShadowVolumeSphere(sceneObjHolder, this, "Ground", this.scale[0] * 50.0);

        calcGravity(sceneObjHolder, this);
        vec3.copy(this.origTranslation, this.translation);
        this.initNerve(MerameraNrv.Wait);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);

        declareCoin(sceneObjHolder, this, 1);

        // initAppearState()
        this.appearType = fallback(getJMapInfoArg0(infoIter), -1);
        this.resetAppear(sceneObjHolder);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        this.updatePose();
        vec3.negate(scratchVec3a, this.gravityVector);
        turnVecToVecRadian(this.effectUp, this.effectUp, scratchVec3a, 1.0, this.axisZ);
        const sinMtx = getJointMtxByName(this, 'Sin')!;
        getMatrixTranslation(scratchVec3a, sinMtx);
        makeMtxUpNoSupportPos(this.effectMtx, this.effectUp, scratchVec3a);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MerameraNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MerameraNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                this.emitEffectHead(sceneObjHolder, MerameraEffectHead.Wait);
                this.emitEffectHeatBody(sceneObjHolder);
            }

            addVelocityKeepHeightUseShadow(this, 130.0, 0.5 * deltaTimeFrames, 0.1 * deltaTimeFrames, 15.0 * deltaTimeFrames);
            attenuateVelocity(this, 0.98 ** deltaTimeFrames);
            reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);
    
            if (this.tryChase(sceneObjHolder))
                return;
    
            if (this.tryWalk(sceneObjHolder))
                return;
        } else if (currentNerve === MerameraNrv.Walk) {
            if (isFirstStep(this)) {
                this.emitEffectHead(sceneObjHolder, MerameraEffectHead.Wait);
                this.emitEffectHeatBody(sceneObjHolder);
            }

            addVelocityKeepHeightUseShadow(this, 130.0, 0.5 * deltaTimeFrames, 0.1 * deltaTimeFrames, 15.0 * deltaTimeFrames);
            this.addToTargetMovingAccel(this.targetWalkPos, 0.05 * deltaTimeFrames, 0.995 * deltaTimeFrames);
            attenuateVelocity(this, 0.98 ** deltaTimeFrames);
            reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);

            if (this.tryChase(sceneObjHolder))
                return;
    
            if (this.tryWalkEnd(sceneObjHolder))
                return;
        }
    }

    private updatePose(): void {
        const rollBall = this.isNerve(MerameraNrv.Runaway) || this.isNerve(MerameraNrv.StartDiving) || this.isNerve(MerameraNrv.Diving);

        vec3.negate(scratchVec3a, this.gravityVector);
        if (rollBall) {
            rotateQuatRollBall(this.poseQuat, this.velocity, scratchVec3a, 50.0);
        } else {
            blendQuatUpFront(this.poseQuat, this.poseQuat, scratchVec3a, this.axisZ, 0.25, 0.25);
        }
    }

    private addMovingAccel(delta: ReadonlyVec3, speed: number, turnSpeed: number): void {
        vecKillElement(scratchVec3a, delta, this.gravityVector);
        this.distanceToGoal = vec3.length(scratchVec3a);
        vec3.normalize(scratchVec3a, scratchVec3a);
        if (!isNearZeroVec3(scratchVec3a, 0.001)) {
            if (turnSpeed <= -1.0 || turnSpeed >= 1.0)
                vec3.copy(this.axisZ, scratchVec3a);
            else
                turnVecToVecCos(this.axisZ, this.axisZ, scratchVec3a, turnSpeed, this.gravityVector, 0.02);
        }

        vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, speed);
    }

    private addToTargetMovingAccel(target: ReadonlyVec3, speed: number, turnSpeed: number): void {
        vec3.sub(scratchVec3a, target, this.translation);
        this.addMovingAccel(scratchVec3a, speed, turnSpeed);
    }

    private resetAppear(sceneObjHolder: SceneObjHolder): void {
        vec3.copy(this.translation, this.origTranslation);
        vec3.zero(this.velocity);
        calcGravity(sceneObjHolder, this);
        if (this.appearType === 1) {
            startBck(this, 'Wait');
            hideModel(this);
            this.calcBinderFlag = false;
            vec3.negate(scratchVec3a, this.gravityVector);
            makeMtxUpNoSupportPos(this.effectFallMtx, scratchVec3a, this.translation);
            this.deleteEffectHead(sceneObjHolder, false);
            this.emitEffectColdBody(sceneObjHolder);
            //
            this.setNerve(MerameraNrv.Float);
        } else if (this.appearType === 0) {
            this.setNerve(MerameraNrv.Runaway);
        } else {
            this.setNerve(MerameraNrv.Wait);
        }

        resetPosition(sceneObjHolder, this);
    }

    private static getEffectHeadStr(v: MerameraEffectHead): string {
        if (v === MerameraEffectHead.Wait)
            return 'Wait';
        else if (v === MerameraEffectHead.Chase)
            return 'Chase';
        else if (v === MerameraEffectHead.Escape)
            return 'Escape';
        else
            throw "whoops";
    }

    private emitEffectHead(sceneObjHolder: SceneObjHolder, effect: MerameraEffectHead): void {
        if (this.effectHead !== effect) {
            this.deleteEffectHead(sceneObjHolder, false);
            this.effectHead = effect;

            const name = Meramera.getEffectHeadStr(this.effectHead);
            emitEffect(sceneObjHolder, this, name);
        }
    }

    private deleteEffectHead(sceneObjHolder: SceneObjHolder, force: boolean): void {
        if (this.effectHead !== MerameraEffectHead.None) {
            const name = Meramera.getEffectHeadStr(this.effectHead);
            if (force)
                forceDeleteEffect(sceneObjHolder, this, name);
            else
                deleteEffect(sceneObjHolder, this, name);
            this.effectHead = MerameraEffectHead.None;
        }
    }

    private emitEffectHeatBody(sceneObjHolder: SceneObjHolder): void {
        if (this.effectBody !== MerameraEffectBody.Heat) {
            this.effectBody = MerameraEffectBody.Heat;
            startBtp(this, 'OnFire');
            startBrk(this, 'OnFire');
        }
    }

    private emitEffectCoolDownBody(sceneObjHolder: SceneObjHolder): void {
        if (this.effectBody !== MerameraEffectBody.CoolDown) {
            this.effectBody = MerameraEffectBody.CoolDown;
            startBtp(this, 'RedToBlack');
            startBrk(this, 'RedToBlack');
        }
    }

    private emitEffectColdBody(sceneObjHolder: SceneObjHolder): void {
        if (this.effectBody !== MerameraEffectBody.Cold) {
            this.effectBody = MerameraEffectBody.Cold;
            startBtp(this, 'OffFire');
            startBrk(this, 'OffFire');
        }
    }

    private tryChase(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryWalk(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterEqualStep(this, 120)) {
            getRandomVector(scratchVec3a, 1.0);
            vec3.normalize(scratchVec3a, scratchVec3a);

            vecKillElement(scratchVec3a, scratchVec3a, this.gravityVector);
            vec3.scaleAndAdd(this.targetWalkPos, this.origTranslation, scratchVec3a, 200.0);
            this.setNerve(MerameraNrv.Walk);
            return true;
        }

        return false;
    }

    private tryWalkEnd(sceneObjHolder: SceneObjHolder): boolean {
        if (isGreaterEqualStep(this, 300) || (this.distanceToGoal >= 0.0 && this.distanceToGoal <= 100.0)) {
            this.setNerve(MerameraNrv.Wait);
            return true;
        }

        return false;
    }
}

const enum KillerGunnerSingleNrv { Wait, Charge, Shoot }
export class KillerGunnerSingle extends LiveActor<KillerGunnerSingleNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, `KillerGunnerSingle`);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'KillerGunnerSingle');
        connectToSceneEnvironment(sceneObjHolder, this);

        this.initHitSensor();
        const bodySensor = addHitSensorMapObj(sceneObjHolder, this, `body`, 16, 0.0, Vec3Zero);
        addHitSensorEnemy(sceneObjHolder, this, `shell`, 16, 250.0, vec3.set(scratchVec3a, 0.0, 0.0, 700.0));
        initCollisionParts(sceneObjHolder, this, `KillerGunnerSingle`, bodySensor);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(KillerGunnerSingleNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KillerGunnerSingleNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KillerGunnerSingleNrv.Wait) {
            if (isFirstStep(this))
                this.getSensor('shell')!.invalidate();

            if (isGreaterEqualStep(this, 120))
                this.setNerve(KillerGunnerSingleNrv.Charge);
        } else if (currentNerve === KillerGunnerSingleNrv.Charge) {
            if (isFirstStep(this))
                startBtk(this, 'KillerGunnerSingleCharge');

            if (isBtkStopped(this)) {
                startBck(this, 'KillerGunnerSingleShoot');
                emitEffect(sceneObjHolder, this, 'KillerGunnerSingleSmoke');
                this.setNerve(KillerGunnerSingleNrv.Shoot);
            }
        } else if (currentNerve === KillerGunnerSingleNrv.Shoot) {
            if (isFirstStep(this)) {
                // startRumbleWithShakeCameraWeak
                this.getSensor('shell')!.validate();
            }

            if (isGreaterEqualStep(this, 40))
                this.getSensor('shell')!.invalidate();

            if (isBckStopped(this))
                this.setNerve(KillerGunnerSingleNrv.Wait);
        }
    }
}

export class StinkBugBase<T extends number> extends LiveActor<T> {
    protected homePos = vec3.create();
    protected moveRadius: number;
    protected axisZ = vec3.create();
    protected axisZTarget = vec3.create();
    protected turnConeAngle: number;
    protected turnDir: number = -1;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneCollisionEnemyNoShadowedMapObjStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        initShadowFromCSV(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        // addEffectHitNormal
        // initSound
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        vec3.copy(this.homePos, this.translation);
        calcFrontVec(this.axisZ, this);
        vec3.copy(this.axisZTarget, this.axisZ);
        calcUpVec(this.gravityVector, this);
        vec3.negate(this.gravityVector, this.gravityVector);
    }

    protected fixInitPos(): void {
        vec3.zero(this.velocity);
        vec3.copy(this.translation, this.homePos);
    }

    protected isPlayerInTerritory(sceneObjHolder: SceneObjHolder, radiusAdd: number, threshX: number, threshY: number, coneSize: number): boolean {
        if (!isNearPlayer(sceneObjHolder, this, this.moveRadius + radiusAdd))
            return false;

        // noclip modification -- make threshes much larger because camera, not player
        threshX *= 4.0;
        threshY *= 10.0;

        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);

        calcUpVec(scratchVec3b, this);
        if (Math.abs(vec3.dot(scratchVec3a, scratchVec3b)) > threshY)
            return false;

        calcSideVec(scratchVec3b, this);
        if (Math.abs(vec3.dot(scratchVec3a, scratchVec3b)) > threshX)
            return false;

        if (this.turnConeAngle === 0.0) {
            return vec3.dot(this.axisZ, scratchVec3a) >= 0.0;
        } else if (this.turnConeAngle >= MathConstants.TAU / 2) {
            return true;
        } else {
            vec3.scaleAndAdd(scratchVec3b, this.translation, this.axisZTarget, -coneSize / Math.sin(this.turnConeAngle));
            getPlayerPos(scratchVec3a, sceneObjHolder);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);

            vecKillElement(scratchVec3a, scratchVec3a, this.gravityVector);
            vec3.normalize(scratchVec3a, scratchVec3a);
            return vec3.dot(scratchVec3a, this.axisZTarget) >= Math.cos(this.turnConeAngle);
        }
    }

    protected tryTurnDashSign(sceneObjHolder: SceneObjHolder, speedInDegrees: number): void {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        turnDirectionToTargetUseGroundNormalDegree(this, this.axisZ, scratchVec3a, speedInDegrees);
        clampVecAngleRad(this.axisZ, this.axisZTarget, this.turnConeAngle);
    }

    protected tryTurnSearch(speedInDegrees: number): boolean {
        rotateVecDegree(this.axisZ, this.gravityVector, speedInDegrees * this.turnDir);
        if (vec3.dot(this.axisZ, this.axisZTarget) < Math.cos(this.turnConeAngle)) {
            clampVecAngleRad(this.axisZ, this.axisZTarget, this.turnConeAngle);
            this.turnDir *= -1.0;
            return true;
        } else {
            return false;
        }
    }

    protected setDashVelocity(speed: number): void {
        vec3.scaleAndAdd(scratchVec3a, this.homePos, this.axisZ, this.moveRadius);
        if (vec3.squaredDistance(this.translation, scratchVec3a) <= speed ** 2.0)
            speed = this.moveRadius;

        vec3.scale(this.velocity, this.axisZ, speed);
    }
}

const enum StinkBugSmallNrv { Wait, DashSign, DashSignEnd, Dash, DashEnd, Back, Search, ForceFall }
export class StinkBugSmall extends StinkBugBase<StinkBugSmallNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
        this.turnConeAngle = fallback(getJMapInfoArg0(infoIter), 180.0) * MathConstants.DEG_TO_RAD;
        this.moveRadius = fallback(getJMapInfoArg1(infoIter), 1000.0);

        this.initHitSensor();
        const arg7 = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
        if (arg7) {
            addHitSensorEnemy(sceneObjHolder, this, 'body', 8, this.scale[0] * 110.0, vec3.set(scratchVec3a, this.scale[0] * 10.0, 0.0, 0.0));
        } else {
            addBodyMessageSensorEnemy(sceneObjHolder, this);
        }

        const size = this.scale[0] * 200.0;
        this.initBinder(size, size, 0);
        setBinderExceptActor(this, this);
        setBinderIgnoreMovingCollision(this);

        if (!isValidSwitchDead(this))
            declareStarPiece(sceneObjHolder, this, 3);

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        startBrk(this, `Death`);
        setBrkFrameAndStop(this, 0);

        this.initNerve(StinkBugSmallNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        calcMtxFromGravityAndZAxis(scratchMatrix, this, this.gravityVector, this.axisZ);
        const dst = this.modelInstance!.modelMatrix;
        blendMtx(dst, dst, scratchMatrix, 0.3);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (isInDeath(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return;
        }

        if (this.tryDPDSwoon(sceneObjHolder))
            return;

        if (this.tryForceFall(sceneObjHolder) || this.isNerve(StinkBugSmallNrv.ForceFall))
            return;

        if (this.isNerve(StinkBugSmallNrv.Dash) || this.isNerve(StinkBugSmallNrv.Back)) {
            this.calcBinderFlag = true;
            if (isBindedGround(this))
                vec3.negate(this.gravityVector, getGroundNormal(this));

            vecKillElement(this.velocity, this.velocity, this.gravityVector);
            vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, 2.0);
            turnVecToPlane(this.axisZ, this.axisZ, this.gravityVector);
        } else {
            this.calcBinderFlag = false;
        }
    }

    private tryDPDSwoon(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryForceFall(sceneObjHolder: SceneObjHolder): boolean {
        if (isValidSwitchA(this) && isOnSwitchA(sceneObjHolder, this)) {
            if (this.isNerve(StinkBugSmallNrv.ForceFall))
                return false;

            this.setNerve(StinkBugSmallNrv.ForceFall);
            return true;
        }

        return false;
    }

    public override initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        calcUpVec(scratchVec3a, this);
        vec3.scale(scratchVec3b, scratchVec3a, -500);
        vec3.scaleAndAdd(scratchVec3a, this.translation, scratchVec3a, 50);
        getFirstPolyOnLineToMapExceptSensor(sceneObjHolder, this.homePos, null, scratchVec3a, scratchVec3b, this.getSensor('body')!);
        vec3.copy(this.translation, this.homePos);
        resetPosition(sceneObjHolder, this);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: StinkBugSmallNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === StinkBugSmallNrv.Wait) {
            if (isFirstStep(this) && this.turnConeAngle === 0.0)
                tryStartBck(this, `Search`);

            this.fixInitPos();
            if (this.isPlayerInTerritory(sceneObjHolder, 400.0, 600.0, 200.0, 200.0)) {
                this.setNerve(StinkBugSmallNrv.DashSign);
            } else {
                if (this.turnConeAngle !== 0.0 && isGreaterStep(this, 1))
                    this.setNerve(StinkBugSmallNrv.Search);
            }
        } else if (currentNerve === StinkBugSmallNrv.DashSign) {
            if (isFirstStep(this))
                startBck(this, `RushStart`);

            this.fixInitPos();
            this.tryTurnDashSign(sceneObjHolder, 3.0);
            if (isBckStopped(this))
                this.setNerve(StinkBugSmallNrv.DashSignEnd);
        } else if (currentNerve === StinkBugSmallNrv.DashSignEnd) {
            if (isGreaterEqualStep(this, 10))
                this.setNerve(StinkBugSmallNrv.Dash);
        } else if (currentNerve === StinkBugSmallNrv.Dash) {
            if (isFirstStep(this)) {
                startBck(this, `Rush`);
                validateHitSensors(this);
            }

            if (!(vec3.squaredDistance(this.translation, this.homePos) <= this.moveRadius ** 2.0) || isBindedWall(this)) {
                vec3.zero(this.velocity);
                this.setNerve(StinkBugSmallNrv.DashEnd);
            } else {
                this.setDashVelocity(20.0);
            }
        } else if (currentNerve === StinkBugSmallNrv.DashEnd) {
            if (isFirstStep(this))
                startBck(this, `RushStop`);

            vec3.zero(this.velocity);
            if (isBckStopped(this))
                this.setNerve(StinkBugSmallNrv.Back);
        } else if (currentNerve === StinkBugSmallNrv.Back) {
            if (isFirstStep(this)) {
                startBck(this, `Back`);
                this.getSensor(`head`)!.invalidate();
            }

            if (vec3.squaredDistance(this.translation, this.homePos) < 10.0 ** 2.0) {
                this.setNerve(StinkBugSmallNrv.Wait);
            } else {
                vec3.sub(scratchVec3a, this.homePos, this.translation);
                vec3.normalize(scratchVec3a, scratchVec3a);
                turnVecToPlane(scratchVec3a, scratchVec3a, this.gravityVector);
                vec3.scale(this.velocity, scratchVec3a, 5.0);
            }
        } else if (currentNerve === StinkBugSmallNrv.Search) {
            if (isFirstStep(this))
                tryStartBck(this, `Search`);

            this.fixInitPos();
            if (this.tryTurnSearch(1.0)) {
                this.setNerve(StinkBugSmallNrv.Wait);
            } else {
                if (this.isPlayerInTerritory(sceneObjHolder, 400.0, 600.0, 200.0, 200.0))
                    this.setNerve(StinkBugSmallNrv.DashSign);
            }
        } else if (currentNerve === StinkBugSmallNrv.ForceFall) {
            if (isFirstStep(this)) {
                vec3.zero(this.velocity);
                this.calcGravityFlag = true;
                this.calcBinderFlag = true;
            }

            vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, 2.0 * deltaTimeFrames);
        }
    }
}

const enum KameckFireBallNrv { Wait, }
class KameckFireBall extends LiveActor<KameckFireBallNrv> {
    private poseQuat = quat.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, name: string) {
        super(zoneAndLayer, sceneObjHolder, name);
        this.initModelManagerWithAnm(sceneObjHolder, 'BossKameckFireBall');
        connectToSceneEnemy(sceneObjHolder, this);
        this.initNerve(KameckFireBallNrv.Wait);
        this.initHitSensor();
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 58.0, Vec3Zero);
        // initStarPointerTarget
        this.initBinder(58.0, 0.0, 0);
        // setKameckBeamCollisionFilter
        initShadowVolumeSphere(sceneObjHolder, this, 58.0);
        onCalcShadow(this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.makeActorDead(sceneObjHolder);
    }

    public appearDirection(sceneObjHolder: SceneObjHolder, dir: ReadonlyVec3): void {
        this.makeActorAppeared(sceneObjHolder);
        this.calcGravityFlag = true;
        calcGravity(sceneObjHolder, this);

        vec3.scale(this.velocity, this.gravityVector, 15.0);
        vec3.scaleAndAdd(this.velocity, this.velocity, dir, 15.0);
    }

    public disappear(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'BeamFireVanish');
        this.makeActorDead(sceneObjHolder);
    }

    protected override calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        showModel(this);
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(KameckFireBallNrv.Wait);
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        // this.eventListener = null;
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KameckFireBallNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KameckFireBallNrv.Wait) {
            if (isFirstStep(this))
                startAction(this, 'BossKameckFireBall');

            vec3.negate(scratchVec3a, this.gravityVector);
            rotateQuatRollBall(this.poseQuat, this.velocity, scratchVec3a, 58.0);
            addVelocityToGravity(this, 0.5 * deltaTimeFrames);
            attenuateVelocity(this, 0.995 ** deltaTimeFrames);
            reboundVelocityFromCollision(this, 1.0, 0.0, 1.0);

            if (isGreaterStep(this, 180) || isInWater(sceneObjHolder, this.translation))
                this.disappear(sceneObjHolder);
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('BossKameckFireBall');
    }
}

export class KameckFireBallHolder extends LiveActorGroup<KameckFireBall> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'KameckFireBallHolder', 0x10);

        for (let i = 0; i < 0x10; i++) {
            const kameckFireBall = new KameckFireBall(dynamicSpawnZoneAndLayer, sceneObjHolder, 'KameckFireBall');
            kameckFireBall.makeActorDead(sceneObjHolder);
            this.registerActor(kameckFireBall);
        }
    }
}

const enum KameckTurtleNrv { }
class KameckTurtle extends LiveActor<KameckTurtleNrv> {
    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('Koura');
    }
}

export class KameckBeamTurtleHolder extends LiveActorGroup<KameckTurtle> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'KameckBeamTurtleHolder', 0x10);

        for (let i = 0; i < 0x10; i++) {
            const kameckBeamTurtle = new KameckTurtle(dynamicSpawnZoneAndLayer, sceneObjHolder, 'KameckBeamTurtle');
            kameckBeamTurtle.makeActorDead(sceneObjHolder);
            this.registerActor(kameckBeamTurtle);
        }
    }
}

const enum KameckBeamNrv { FollowWand, Shoot, Explosion, Fire, JetTurtle }
const enum KameckBeamKind { Turtle, FireBall1, FireBall2, FireBall3, }
class KameckBeam extends LiveActor<KameckBeamNrv> {
    private wandMtx: ReadonlyMat4 | null = null;
    private wandLocalPosition = vec3.create();
    private beamKind: KameckBeamKind;
    private shootDir = vec3.create();
    private fireball: KameckFireBall[] = [];
    private turtle: KameckTurtle | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, name: string) {
        super(zoneAndLayer, sceneObjHolder, name);

        connectToSceneEnemyDecorationMovementCalcAnim(sceneObjHolder, this);
        this.initNerve(KameckBeamNrv.FollowWand);
        this.initBinder(80.0, 0.0, 0);
        // setBinderCollisionPartsFilter
        this.initEffectKeeper(sceneObjHolder, 'BossKameckBeam');
        setEffectHostSRT(this, 'BeamTurtleReady', this.translation, null, null);
        setEffectHostSRT(this, 'BeamFireReady', this.translation, null, null);
        setEffectHostSRT(this, 'BeamTurtle', this.translation, null, null);
        setEffectHostSRT(this, 'BeamFire', this.translation, null, null);
        this.initHitSensor();
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 80.0, Vec3Zero);
        initShadowVolumeSphere(sceneObjHolder, this, 80.0);
        onCalcShadow(this);
        this.makeActorDead(sceneObjHolder);
    }

    public override calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.wandMtx === null)
            return;

        transformVec3Mat4w1(this.translation, this.wandMtx, this.wandLocalPosition);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KameckBeamNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KameckBeamNrv.Shoot) {
            if (this.tryShootEnd(sceneObjHolder))
                return;

            if (isInWater(sceneObjHolder, this.translation)) {
                this.emitBeamBreakEffect(sceneObjHolder);
                this.makeActorDead(sceneObjHolder);
            }
        } else if (currentNerve === KameckBeamNrv.Explosion) {
            if (this.beamKind === KameckBeamKind.Turtle) {
                if (this.tryChangeTurtle(sceneObjHolder)) {
                    this.emitBeamBreakEffect(sceneObjHolder);
                    return;
                }
            } else {
                if (this.tryChangeFire(sceneObjHolder)) {
                    this.emitBeamBreakEffect(sceneObjHolder);
                    return;
                }
            }

            this.makeActorDead(sceneObjHolder);
        } else if (currentNerve === KameckBeamNrv.Fire) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'BeamFireBurn');

            if (isCrossedStep(this, 40))
                emitEffect(sceneObjHolder, this, 'BeamFireBurn');

            let isAnyAlive = false;
            for (let i = 0; i < this.fireball.length; i++) {
                if (!isDead(this.fireball[i]!)) {
                    isAnyAlive = true;
                    break;
                }
            }

            if (!isAnyAlive)
                this.makeActorDead(sceneObjHolder);
        } else if (currentNerve === KameckBeamNrv.JetTurtle) {
            if (isDead(this.turtle!))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public resetBeam(sceneObjHolder: SceneObjHolder): void {
        if (this.turtle !== null) {
            if (!isDead(this.turtle))
                this.turtle.makeActorDead(sceneObjHolder);
            this.turtle = null;
        }

        for (let i = 0; i < this.fireball.length; i++) {
            if (!isDead(this.fireball[i]))
                this.fireball[i].disappear(sceneObjHolder);
        }

        this.fireball.length = 0;
        // this.eventListener = null;
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        this.resetBeam(sceneObjHolder);
    }

    public setBeamKind(beamKind: KameckBeamKind): void {
        this.beamKind = beamKind;
    }

    public requestFollowWand(sceneObjHolder: SceneObjHolder, mtx: ReadonlyMat4, scale: number): void {
        vec3SetAll(this.scale, scale);
        const radius = scale * 80.0;
        setShadowVolumeSphereRadius(this, null, radius);
        setBinderRadius(this, radius);
        setSensorRadius(this, 'attack', radius);
        this.emitBeamReadyEffect(sceneObjHolder);
        this.wandMtx = mtx;
        this.makeActorAppeared(sceneObjHolder);
        this.setNerve(KameckBeamNrv.FollowWand);
        this.calcBinderFlag = false;
        invalidateHitSensors(this);
        invalidateShadowAll(this);
    }

    private requestShoot(sceneObjHolder: SceneObjHolder, dir: ReadonlyVec3, speed: number): void {
        this.emitBeamEffect(sceneObjHolder);
        this.calcBinderFlag = true;
        validateHitSensors(this);
        validateShadowAll(this);
        this.wandMtx = null;
        this.setNerve(KameckBeamNrv.Shoot);
        vec3.copy(this.shootDir, dir);
        vec3.scale(this.velocity, this.shootDir, speed);
    }

    public requestShootToPlayerCenter(sceneObjHolder: SceneObjHolder, speed: number): void {
        getPlayerPos(scratchVec3a, sceneObjHolder); // getPlayerCenterPos

        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);
        this.requestShoot(sceneObjHolder, scratchVec3a, speed);
    }

    public setWandLocalPosition(pos: ReadonlyVec3): void {
        vec3.copy(this.wandLocalPosition, pos);
    }

    public setEventListener(beamEventListener: null): void {
        //
    }

    private emitBeamReadyEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.beamKind === KameckBeamKind.Turtle) {
            emitEffect(sceneObjHolder, this, 'BeamTurtleReady');
        } else {
            emitEffect(sceneObjHolder, this, 'BeamFireReady');
        }
    }

    private emitBeamEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.beamKind === KameckBeamKind.Turtle) {
            emitEffect(sceneObjHolder, this, 'BeamTurtle');
        } else {
            emitEffect(sceneObjHolder, this, 'BeamFire');
        }
    }

    private emitBeamBreakEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.beamKind === KameckBeamKind.Turtle) {
            emitEffect(sceneObjHolder, this, 'BeamTurtleBreak');
        } else {
            emitEffect(sceneObjHolder, this, 'BeamFireBreak');
        }
    }

    private tryShootEnd(sceneObjHolder: SceneObjHolder): boolean {
        if (isBinded(this)) {
            // const attackSensor = this.getSensor('attack')!;
            // sendMsgEnemyAttackExplosionToBindedSensor(sceneObjHolder, attackSensor)
            invalidateHitSensors(this);
            vec3.zero(this.velocity);
            this.setNerve(KameckBeamNrv.Explosion);
            return true;
        } else if (isGreaterStep(this, 360)) {
            this.makeActorDead(sceneObjHolder);
            return true;
        } else {
            return false;
        }
    }

    private static readonly FIRE_DEGREES: number[][] = [
        [ 0.0 ],
        [ -30.0, 30.0 ],
        [ 0.0, -120.0, 120.0 ],
    ];

    private tryChangeFire(sceneObjHolder: SceneObjHolder): boolean {
        vecKillElement(scratchVec3a, this.shootDir, this.gravityVector);

        const count0 = (this.beamKind - KameckBeamKind.FireBall1);
        assert(count0 < KameckBeam.FIRE_DEGREES.length);
        const count = count0 + 1;
        assert(this.fireball.length === 0);

        for (let i = 0; i < count; i++) {
            const kameckFireBall = sceneObjHolder.kameckFireBallHolder!.getDeadActor();
            if (kameckFireBall === null)
                break;

            vec3.copy(kameckFireBall.translation, this.translation);
            vec3.copy(scratchVec3b, scratchVec3a);
            rotateVecDegree(scratchVec3b, this.gravityVector, KameckBeam.FIRE_DEGREES[count0][i]);
            kameckFireBall.appearDirection(sceneObjHolder, scratchVec3b);
            this.fireball.push(kameckFireBall);
        }

        if (this.fireball.length > 0) {
            this.calcBinderFlag = false;
            invalidateShadowAll(this);
            invalidateHitSensors(this);
            forceDeleteEffectAll(sceneObjHolder, this);
            this.setNerve(KameckBeamNrv.Fire);
            return true;
        }

        return false;
    }

    private tryChangeTurtle(sceneObjHolder: SceneObjHolder): boolean {
        // TODO(jstpierre): KameckBeamTurtle
        if (this.turtle !== null) {
            this.calcBinderFlag = false;
            invalidateShadowAll(this);
            invalidateHitSensors(this);
            forceDeleteEffectAll(sceneObjHolder, this);
            // vec3.copy(this.turtle.translation, this.translation);
            // this.turtle.appearDirection(sceneObjHolder, this.shootDir);
            this.setNerve(KameckBeamNrv.JetTurtle);
            return true;
        }

        return false;
    }
}

export class KameckBeamHolder extends LiveActorGroup<KameckBeam> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'KameckBeamHolder', 0x10);

        for (let i = 0; i < 0x10; i++) {
            const kameckBeam = new KameckBeam(dynamicSpawnZoneAndLayer, sceneObjHolder, 'KameckBeam');
            kameckBeam.makeActorDead(sceneObjHolder);
            this.registerActor(kameckBeam);
        }
    }
}

function startFollowKameckBeam(sceneObjHolder: SceneObjHolder, beamKind: KameckBeamKind, mtx: ReadonlyMat4, scale: number, pos: ReadonlyVec3, beamEventListener: null): KameckBeam | null {
    const beam = sceneObjHolder.kameckBeamHolder!.getDeadActor();
    if (beam === null)
        return null;

    beam.setBeamKind(beamKind);
    beam.requestFollowWand(sceneObjHolder, mtx, scale);
    beam.setWandLocalPosition(pos);
    beam.setEventListener(beamEventListener);
    return beam;
}

class ActiveActorList<T extends LiveActor> {
    private actors: T[] = [];

    constructor(private maxCount: number) {
    }

    public isFull(): boolean {
        return this.actors.length >= this.maxCount;
    }

    public addActor(actor: T): void {
        assert(!this.isFull());
        this.actors.push(actor);
    }

    public clear(): void {
        this.actors.length = 0;
    }

    public removeDeadActor(): void {
        for (let i = 0; i < this.actors.length; i++)
            if (isDead(this.actors[i]))
                this.actors.splice(i--, 1);
    }
}

const enum KameckNrv { Wait, AttackWait, Attack, MoveHide, Move, Appear }
export class Kameck extends LiveActor<KameckNrv> {
    private beamKind: KameckBeamKind;
    private nonActiveDistance: number;
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private activeBeams = new ActiveActorList<KameckBeam>(8);
    private beamTemp: KameckBeam | null = null;
    private beamEventListener: null = null;
    private moveRailCoord0: number;
    private moveRailCoord1: number;
    private moveDuration: number = 240;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.nonActiveDistance = fallback(getJMapInfoArg3(infoIter), 3000.0);

        if (this.name === 'FireBallBeamKameck') {
            const arg0 = getJMapInfoArg0(infoIter);
            if (arg0 === 2)
                this.beamKind = KameckBeamKind.FireBall2;
            else if (arg0 === 3)
                this.beamKind = KameckBeamKind.FireBall3;
            else    
                this.beamKind = KameckBeamKind.FireBall1;
        } else if (this.name === 'TurtleBeamKameck') {
            this.beamKind = KameckBeamKind.Turtle;
        }

        this.initModelManagerWithAnm(sceneObjHolder, 'Kameck');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 70.0);
        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 120.0, vec3.set(scratchVec3a, 0.0, 40.0, 0.0));
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 80.0, Vec3Zero);
        this.initBinder(70.0, 0.0, 0);
        this.calcBinderFlag = false;
        this.initBeam(sceneObjHolder);
        this.initEffectKeeper(sceneObjHolder, null);

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordToStartPos(this);
            moveTransToCurrentRailPos(this);
        }

        this.initNerve(KameckNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
        declareCoin(sceneObjHolder, this, 1);
    }

    private initBeam(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.KameckBeamHolder);

        if (this.beamKind === KameckBeamKind.Turtle) {
            sceneObjHolder.create(SceneObj.KameckBeamTurtleHolder);
        } else {
            sceneObjHolder.create(SceneObj.KameckFireBallHolder);
        }
    }

    protected override calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);
        vec3.negate(scratchVec3a, this.gravityVector);
        blendQuatUpFront(this.poseQuat, this.poseQuat, scratchVec3a, this.axisZ, 0.04, 0.2);
        this.activeBeams.removeDeadActor();
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KameckNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KameckNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                validateHitSensors(this);
            }

            if (this.tryPointBind(sceneObjHolder))
                return;

            if (this.tryOpeningDemo(sceneObjHolder))
                return;

            this.tryAttackWait(sceneObjHolder);
        } else if (currentNerve === KameckNrv.AttackWait) {
            if (isFirstStep(this))
                startBck(this, 'AttackWait');

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTarget(this.axisZ, this, scratchVec3a, 0.98 * deltaTimeFrames);

            if (this.tryPointBind(sceneObjHolder))
                return;

            if (isGreaterStep(this, 60))
                this.setNerve(KameckNrv.Attack);
        } else if (currentNerve === KameckNrv.Attack) {
            if (isFirstStep(this))
                startBck(this, 'Attack');

            if (isCrossedStep(this, 9)) {
                const beam = assertExists(this.beamTemp);
                beam.requestShootToPlayerCenter(sceneObjHolder, 12.0);
                this.activeBeams.addActor(beam);
                this.beamTemp = null;
            }

            if (this.tryPointBind(sceneObjHolder))
                return;

            if (isGreaterStep(this, 15))
                this.setNerve(KameckNrv.MoveHide);
        } else if (currentNerve === KameckNrv.MoveHide) {
            if (isFirstStep(this))
                startBck(this, 'Hide');

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTarget(this.axisZ, this, scratchVec3a, 0.98 * deltaTimeFrames);

            if (this.tryPointBind(sceneObjHolder))
                return;

            if (isBckStopped(this))
                this.setNerve(KameckNrv.Move);
        } else if (currentNerve === KameckNrv.Move) {
            if (isFirstStep(this)) {
                startBck(this, 'Move');

                hideModel(this);
                invalidateHitSensors(this);
                if (isExistRail(this)) {
                    if (isRailReachedGoal(this))
                        reverseRailDirection(this);

                    this.moveRailCoord0 = getRailCoord(this);
                    const nextPt = getNextRailPointNo(this);
                    this.moveRailCoord1 = getRailPointCoord(this, nextPt);
                    this.moveDuration = Math.abs(this.moveRailCoord1 - this.moveRailCoord0) / 20.0;
                }
            }

            if (isExistRail(this)) {
                const t = saturate(this.getNerveStep() / this.moveDuration);
                const coord = getEaseInOutValue(t, this.moveRailCoord0, this.moveRailCoord1);
                setRailCoord(this, coord);
                moveTransToCurrentRailPos(this);
            }

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTarget(this.axisZ, this, scratchVec3a, 0.98 * deltaTimeFrames);

            if (isGreaterStep(this, this.moveDuration))
                this.setNerve(KameckNrv.Appear);
        } else if (currentNerve === KameckNrv.Appear) {
            if (isFirstStep(this)) {
                startBck(this, 'Appear');
                showModel(this);
                validateHitSensors(this);
            }

            if (isNearPlayer(sceneObjHolder, this, 2000.0)) {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                turnDirectionToTarget(this.axisZ, this, scratchVec3a, 0.98 * deltaTimeFrames);
            }

            if (this.tryPointBind(sceneObjHolder))
                return;

            if (isBckStopped(this)) {
                if (this.tryAttackWait(sceneObjHolder))
                    return;

                this.setNerve(KameckNrv.Wait);
            }
        }
    }

    private tryPointBind(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryOpeningDemo(sceneObjHolder: SceneObjHolder): boolean {
        return false;
    }

    private tryAttackWait(sceneObjHolder: SceneObjHolder): boolean {
        if (isNearPlayer(sceneObjHolder, this, 2000.0) && !this.activeBeams.isFull()) {
            vec3.set(scratchVec3a, 0.0, 110.0, 0.0);
            const wandMtx = getJointMtxByName(this, 'Wand')!;
            this.beamTemp = startFollowKameckBeam(sceneObjHolder, this.beamKind, wandMtx, 0.6, scratchVec3a, this.beamEventListener);
            if (this.beamTemp !== null) {
                this.setNerve(KameckNrv.AttackWait);
                return true;
            }
        }

        return false;
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Kameck');
        const name = getObjectName(infoIter);
        if (name === 'FireBallBeamKameck')
            KameckFireBall.requestArchives(sceneObjHolder);
        else
            KameckTurtle.requestArchives(sceneObjHolder);
    }
}
