
import { LiveActor, MessageType } from './LiveActor';
import { assertExists, fallback } from '../util';
import { Spine, isFirstStep, getStep, isGreaterStep } from './Spine';
import { NameObj } from './NameObj';
import { mat4, vec3 } from 'gl-matrix';
import { JMapInfoIter } from './JMapInfo';
import { computeModelMatrixR, MathConstants, isNearZero } from '../MathHelpers';
import { SceneObjHolder, getDeltaTimeFrames } from './Main';
import { ViewerRenderInput } from '../viewer';
import { moveCoordAndTransToNearestRailPos, moveCoordAndTransToNearestRailPoint, moveCoordAndTransToRailStartPoint, getRailCoord, setRailCoord, getRailPos, isRailGoingToEnd, reverseRailDirection, moveCoordAndFollowTrans, getRailCoordSpeed, getCurrentRailPointNo, getRailPartLength, setRailCoordSpeed, moveCoordToStartPos } from './Actors';

export const enum MoveConditionType { Unconditionally, WaitForPlayerOn }

export function getMapPartsArgMoveConditionType(infoIter: JMapInfoIter): MoveConditionType {
    return fallback(infoIter.getValueNumberNoInit('MoveConditionType'), MoveConditionType.Unconditionally);
}

// Seems to be additional slots at 3, 4, 5...
const enum SignMotionType { None, MoveStart, MoveWait }

function getMapPartsArgSignMotionType(infoIter: JMapInfoIter): SignMotionType {
    return fallback(infoIter.getValueNumberNoInit('SignMotionType'), SignMotionType.None);
}

function hasMapPartsMoveStartSignMotion(signMotionType: SignMotionType): boolean {
    return signMotionType === SignMotionType.MoveStart || signMotionType === SignMotionType.MoveWait;
}

const enum MoveStopType { OnceAndWait, Mirror, Loop, OnceAndVanish }

function getMapPartsArgMoveStopType(actor: LiveActor): MoveStopType {
    return fallback(actor.railRider!.bezierRail.railIter.getValueNumberNoInit('path_arg1'), MoveStopType.Mirror);
}

function getCurrentRailPointArg0(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg0');
}

function getCurrentRailPointArg1(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg1');
}

function getCurrentRailPointArg5(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg5');
}

function getCurrentRailPointArg7(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg7');
}

function getMapPartsArgMoveSpeed(actor: LiveActor): number | null {
    return getCurrentRailPointArg0(actor);
}

function getMapPartsArgMoveTimeToNextPoint(actor: LiveActor): number | null {
    return getCurrentRailPointArg0(actor);
}

function getMapPartsArgAccelTime(actor: LiveActor): number | null {
    return getCurrentRailPointArg1(actor);
}

function getMapPartsArgStopTime(actor: LiveActor): number | null {
    return getCurrentRailPointArg5(actor);
}

const enum SpeedCalcType { DIRECT, TIME }

function getMapPartsArgSpeedCalcType(actor: LiveActor): SpeedCalcType | null {
    return getCurrentRailPointArg7(actor);
}

function getMoveStartSignalTime(): number {
    return 50;
}

const enum RailInitPosType { NearestPos, NearestPoint, Point0 }

function getMapPartsArgRailInitPosType(actor: LiveActor): RailInitPosType {
    const railRider = assertExists(actor.railRider);
    return fallback(railRider.bezierRail.railIter.getValueNumber('path_arg4'), RailInitPosType.NearestPoint);
}

const enum AxisType { X, Y, Z }
const enum AccelType { NORMAL, REVERSE, TIMED }

const scratchVec3 = vec3.create();

const enum MapPartsRotatorNrv { NeverMove, Wait, RotateStart, Rotate, StopAtEnd }

// TODO(jstpierre): MapPartsFunction?
export class MapPartsRotator extends NameObj {
    private rotateAngle: number;
    private rotateAxis: AxisType;
    private rotateAccelType: AccelType;
    private rotateStopTime: number;
    private rotateType: number;
    private rotateSpeed: number;
    private signMotionType: SignMotionType;
    private targetAngle: number = 0;
    private velocity: number = 0;
    private isOnReverse: boolean = false;
    private angle: number = 0;
    private spine: Spine<MapPartsRotatorNrv>;

    private baseHostMtx = mat4.create();
    public mtx = mat4.create();

    constructor(private actor: LiveActor, infoIter: JMapInfoIter) {
        super('MapPartsRotator');

        this.spine = new Spine<MapPartsRotatorNrv>();

        this.rotateAngle = assertExists(infoIter.getValueNumber('RotateSpeed'));
        this.rotateAxis = assertExists(infoIter.getValueNumber('RotateAxis'));
        this.rotateAccelType = assertExists(infoIter.getValueNumber('RotateAccelType'));
        this.rotateStopTime = assertExists(infoIter.getValueNumber('RotateStopTime'));
        this.rotateType = assertExists(infoIter.getValueNumber('RotateType'));
        this.signMotionType = getMapPartsArgSignMotionType(infoIter);

        if (this.rotateAccelType === AccelType.TIMED) {
            const rotateTime = assertExists(infoIter.getValueNumber('RotateSpeed'));
            this.rotateSpeed = this.rotateAngle / rotateTime;
        } else {
            this.rotateSpeed = assertExists(infoIter.getValueNumber('RotateSpeed')) * 0.01;
        }

        if (this.rotateSpeed !== 0) {
            this.spine.setNerve(MapPartsRotatorNrv.Wait);
        } else {
            this.spine.setNerve(MapPartsRotatorNrv.NeverMove);
        }

        this.updateBaseHostMtx();
    }

    public isWorking(): boolean {
        return (
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.NeverMove &&
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.Wait
        );
    }

    private updateTargetAngle(): void {
        if (this.rotateSpeed > 0) {
            this.targetAngle = this.angle + this.rotateAngle;
        } else {
            this.targetAngle = this.angle - this.rotateAngle;
        }
    }

    private updateBaseHostMtx(): void {
        computeModelMatrixR(this.baseHostMtx, this.actor.rotation[0], this.actor.rotation[1], this.actor.rotation[2]);
    }

    private calcRotateAxisDir(v: vec3, axisType: AxisType): void {
        if (axisType === AxisType.X) {
            vec3.set(v, this.baseHostMtx[0], this.baseHostMtx[1], this.baseHostMtx[2]);
        } else if (axisType === AxisType.Y) {
            vec3.set(v, this.baseHostMtx[4], this.baseHostMtx[5], this.baseHostMtx[6]);
        } else if (axisType === AxisType.Z) {
            vec3.set(v, this.baseHostMtx[8], this.baseHostMtx[9], this.baseHostMtx[10]);
        }
    }

    private updateRotateMtx(): void {
        this.calcRotateAxisDir(scratchVec3, this.rotateAxis);
        vec3.normalize(scratchVec3, scratchVec3);
        mat4.identity(this.mtx);
        mat4.rotate(this.mtx, this.mtx, MathConstants.DEG_TO_RAD * this.angle, scratchVec3);
        mat4.mul(this.mtx, this.mtx, this.baseHostMtx);
    }

    public start(): void {
        this.updateTargetAngle();
        this.updateRotateMtx();
        this.spine.setNerve(MapPartsRotatorNrv.Rotate);
    }

    private updateVelocity(): void {
        if (this.rotateAngle !== 0 && this.rotateAccelType === AccelType.REVERSE) {
            // TODO(jstpierre): Reverse accel type
        }

        this.isOnReverse = false;
        this.velocity = this.rotateSpeed;
    }

    private updateAngle(dt: number): void {
        this.angle = this.angle + this.velocity * dt;
        while (this.angle > 360.0)
            this.angle -= 360.0;
        while (this.angle < 0)
            this.angle += 360.0;
    }

    private isReachedTargetAngle(): boolean {
        // TODO(jstpierre)
        return false;
    }

    private restartAtEnd(): void {
        if (this.rotateType !== 0) {
            if (this.rotateType === 1)
                this.rotateSpeed = this.rotateSpeed * -1;
            this.updateTargetAngle();
            if (hasMapPartsMoveStartSignMotion(this.signMotionType))
                this.spine.setNerve(MapPartsRotatorNrv.RotateStart);
            else
                this.spine.setNerve(MapPartsRotatorNrv.Rotate);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.spine.getCurrentNerve() === MapPartsRotatorNrv.Rotate) {
            this.updateVelocity();
            this.updateAngle(getDeltaTimeFrames(viewerInput));

            if ((this.rotateAccelType === AccelType.NORMAL || this.rotateAccelType === AccelType.TIMED) && this.isReachedTargetAngle()) {
                this.angle = this.targetAngle;
                this.updateRotateMtx();

                if (this.rotateStopTime < 1)
                    this.restartAtEnd();
                else
                    this.spine.setNerve(MapPartsRotatorNrv.StopAtEnd);
            } else {
                if (this.rotateAccelType === AccelType.REVERSE && this.velocity === 0)
                    this.spine.setNerve(MapPartsRotatorNrv.StopAtEnd);
                else
                    this.updateRotateMtx();
            }
        }

        super.movement(sceneObjHolder, viewerInput);
    }
}

class MapPartsRailPointPassChecker {
    public currentRailPointId: number = -1;

    constructor(private actor: LiveActor) {
    }

    private getCurrentPointId(): number {
        return this.actor.railRider!.currentPointId;
    }

    public start(): void {
        this.currentRailPointId = this.getCurrentPointId();
    }

    public isPassed(): boolean {
        return this.currentRailPointId !== this.getCurrentPointId();
    }

    public isReachedEnd(): boolean {
        return this.actor.railRider!.isReachedGoal();
    }

    public movement(): void {
        this.currentRailPointId = this.getCurrentPointId();
    }
}

const enum MapPartsRailMoverNrv {
    Wait, MoveStart, Move,
    StopAtPointBeforeRotate, RotateAtPoint, StopAtPointAfterRotate,
    StopAtEndBeforeRotate, RotateAtEndPoint, StopAtEndAfterRotate,
    Vanish,
}

export class MapPartsRailMover extends NameObj {
    private moveConditionType: number;
    private moveStopType: MoveStopType;
    private signMotionType: SignMotionType;
    private translation = vec3.create();
    private startRailCoord: number;
    private passChecker: MapPartsRailPointPassChecker;
    private stopTime: number = 0;
    private accelTime: number = 0;
    private accel: number = 0;
    private moveSpeed: number = 0;
    private startMoveCoord: number = 0;

    public spine: Spine<MapPartsRailMoverNrv>;
    public mtx = mat4.create();

    constructor(private actor: LiveActor, infoIter: JMapInfoIter) {
        super('MapPartsRailMover');

        this.passChecker = new MapPartsRailPointPassChecker(this.actor);
        this.spine = new Spine<MapPartsRailMoverNrv>();

        this.moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        this.moveStopType = getMapPartsArgMoveStopType(this.actor);
        this.signMotionType = getMapPartsArgSignMotionType(infoIter);

        const initPosType = getMapPartsArgRailInitPosType(this.actor);

        if (initPosType === RailInitPosType.NearestPos) {
            moveCoordAndTransToNearestRailPos(this.actor);
        } else if (initPosType === RailInitPosType.NearestPoint) {
            moveCoordAndTransToNearestRailPoint(this.actor);
        } else if (initPosType === RailInitPosType.Point0) {
            moveCoordAndTransToRailStartPoint(this.actor);
        }

        vec3.copy(this.translation, this.actor.translation);
        this.startRailCoord = getRailCoord(this.actor);

        this.spine.setNerve(MapPartsRailMoverNrv.Wait);
    }

    public isWorking(): boolean {
        return (
            this.spine.getCurrentNerve() === MapPartsRailMoverNrv.Move ||
            this.spine.getCurrentNerve() === MapPartsRailMoverNrv.MoveStart
        );
    }

    public isReachedEnd(): boolean {
        const currentNerve = this.spine.getCurrentNerve();

        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart)
            return this.passChecker.isReachedEnd();
        else
            return false;
    }

    public isDone(): boolean {
        if (this.moveStopType !== 0 && this.moveStopType !== 3)
            return false;

        return this.isReachedEnd();
    }

    public start(): void {
        this.moveToInitPos();

        if (hasMapPartsMoveStartSignMotion(this.signMotionType))
            this.spine.setNerve(MapPartsRailMoverNrv.MoveStart);
        else
            this.spine.setNerve(MapPartsRailMoverNrv.Move);
    }

    private sendMsgToHost(msgType: MessageType): boolean {
        return this.actor.receiveMessage(msgType);
    }

    private moveToInitPos(): void {
        if (isNearZero(this.startRailCoord - getRailCoord(this.actor), 0.001)) {
            setRailCoord(this.actor, this.startRailCoord);
            getRailPos(this.translation, this.actor);

            if (!isRailGoingToEnd(this.actor))
                reverseRailDirection(this.actor);
        }
    }

    private calcMoveSpeedTime(): number {
        const moveTimeToNextPoint = fallback(getMapPartsArgMoveTimeToNextPoint(this.actor), -1);
        if (moveTimeToNextPoint >= 0) {
            let currentRailPart = getCurrentRailPointNo(this.actor);
            if (!isRailGoingToEnd(this.actor))
                currentRailPart -= 1;
            const length = getRailPartLength(this.actor, currentRailPart);
            return length / moveTimeToNextPoint;
        } else {
            throw "whoops"; // not sure what to do in this case
        }
    }

    private calcMoveSpeedDirect(): number {
        const moveSpeed = assertExists(getMapPartsArgMoveSpeed(this.actor));
        return moveSpeed;
    }

    private calcMoveSpeed(): number {
        if (isNearZero(this.accel, 0.0001)) {
            const speedCalcType = fallback(getMapPartsArgSpeedCalcType(this.actor), SpeedCalcType.DIRECT);
            if (speedCalcType === SpeedCalcType.TIME)
                return this.calcMoveSpeedTime();
            else
                return this.calcMoveSpeedDirect();
        } else {
            return getRailCoordSpeed(this.actor);
        }
    }

    private updateAccel(): void {
        this.accelTime = fallback(getMapPartsArgAccelTime(this.actor), 0);

        if (this.accelTime < 1) {
            this.accel = 0;
        } else {
            const moveSpeed = fallback(getMapPartsArgMoveSpeed(this.actor), -1);
            if (moveSpeed >= 0) {
                this.accel = (moveSpeed - this.moveSpeed) / this.accelTime;
            } else {
                this.accel = 0;
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        const currentNerve = this.spine.getCurrentNerve();

        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart) {
            this.tryPassPoint();
        } else {
            this.tryRestartAtEnd();
        }

        this.passChecker.movement();

        this.spine.update(getDeltaTimeFrames(viewerInput));

        if (currentNerve === MapPartsRailMoverNrv.Move) {
            if (isFirstStep(this)) {
                this.updateAccel();
                this.moveSpeed = this.calcMoveSpeed();
                this.sendMsgToHost(MessageType.MapPartsRailMover_TryRotateBetweenPoints);
            }

            if (!isNearZero(this.accel, 0.0001) && getStep(this) < this.accelTime)
                this.moveSpeed += this.accel;
            moveCoordAndFollowTrans(this.actor, this.moveSpeed);
        } else if (currentNerve === MapPartsRailMoverNrv.MoveStart) {
            if (isFirstStep(this))
                this.startMoveCoord = getRailCoord(this.actor);

            if (isGreaterStep(this, getMoveStartSignalTime())) {
                setRailCoord(this.actor, this.startMoveCoord);
                getRailPos(this.actor.translation, this.actor);
                this.spine.setNerve(MapPartsRailMoverNrv.MoveStart);
            } else {
                const step = getStep(this);
                const dir = isRailGoingToEnd(this.actor) ? -1 : 1;
                const mag = dir * ((((step / 3) & 1) === 0) ? -1 : 1);
                setRailCoord(this.actor, this.startMoveCoord + (7 * mag * (step % 3)));
                getRailPos(this.actor.translation, this.actor);
            }
        } else if (currentNerve === MapPartsRailMoverNrv.StopAtPointBeforeRotate || currentNerve === MapPartsRailMoverNrv.StopAtPointAfterRotate) {
            if (isFirstStep(this)) {
                this.moveSpeed = 0;
                this.accel = 0;
                setRailCoordSpeed(this.actor, 0);
            }

            if (isGreaterStep(this, this.stopTime)) {
                if (currentNerve === MapPartsRailMoverNrv.StopAtPointBeforeRotate) {
                    if (this.sendMsgToHost(MessageType.MapPartsRailMover_TryRotate))
                        this.spine.setNerve(MapPartsRailMoverNrv.RotateAtPoint);
                    else
                        this.spine.setNerve(MapPartsRailMoverNrv.StopAtPointAfterRotate);
                } else {
                    this.spine.setNerve(MapPartsRailMoverNrv.Move);
                }
            }
        } else if (currentNerve === MapPartsRailMoverNrv.StopAtEndBeforeRotate || currentNerve === MapPartsRailMoverNrv.StopAtEndAfterRotate) {
            if (!this.tryRestartAtEnd() && isGreaterStep(this, this.stopTime)) {
                if (currentNerve === MapPartsRailMoverNrv.StopAtEndBeforeRotate) {
                    if (this.sendMsgToHost(MessageType.MapPartsRailMover_TryRotate))
                        this.spine.setNerve(MapPartsRailMoverNrv.RotateAtEndPoint);
                    else
                        this.spine.setNerve(MapPartsRailMoverNrv.StopAtEndAfterRotate);
                } else {
                    this.restartAtEnd();
                }
            }
        } else if (currentNerve === MapPartsRailMoverNrv.Vanish) {
            if (isFirstStep(this))
                this.sendMsgToHost(MessageType.MapPartsRailMover_Vanish);
        }

        super.movement(sceneObjHolder, viewerInput);
    }

    private reachedEndPlayerOn(): void {
        // This should never happen -- it would require the player to be on, and we don't have a player!
    }

    private setStateStopAtEndBeforeRotate(): void {
        this.moveSpeed = 0;
        this.accel = 0;
        setRailCoordSpeed(this.actor, 0);
        this.stopTime = fallback(getMapPartsArgStopTime(this.actor), 0);
        if (this.stopTime < 1) {
            if (this.actor.receiveMessage(MessageType.MapPartsRailMover_TryRotate)) {
                this.spine.setNerve(MapPartsRailMoverNrv.RotateAtEndPoint);
            } else {
                this.restartAtEnd();
            }
        } else {
            this.spine.setNerve(MapPartsRailMoverNrv.StopAtPointBeforeRotate);
        }
    }

    private reachedEnd(): void {
        if (this.moveStopType === MoveStopType.Mirror)
            reverseRailDirection(this.actor);

        if (this.moveConditionType === 1)
            this.reachedEndPlayerOn();
        else
            this.setStateStopAtEndBeforeRotate();
    }

    private tryPassPoint(): boolean {
        if (this.passChecker.isReachedEnd()) {
            if (this.moveStopType === MoveStopType.OnceAndWait) {
                this.spine.setNerve(MapPartsRailMoverNrv.Wait);
                return true;
            } else {
                this.reachedEnd();
                return true;
            }
        } else {
            if (this.passChecker.isPassed()) {
                this.passPoint();
                return true;
            }
        }

        return false;
    }

    private passPoint(): void {
        this.stopTime = fallback(getMapPartsArgStopTime(this.actor), 0);

        if (this.stopTime < 1) {
            if (!this.sendMsgToHost(MessageType.MapPartsRailMover_TryRotateBetweenPoints)) {
                if (this.sendMsgToHost(MessageType.MapPartsRailMover_TryRotate)) {
                    this.spine.setNerve(MapPartsRailMoverNrv.RotateAtPoint);
                } else {
                    this.spine.setNerve(MapPartsRailMoverNrv.Move);
                }
            }
        } else {
            this.spine.setNerve(MapPartsRailMoverNrv.StopAtPointBeforeRotate);
        }
    }

    private tryRestartAtEnd(): boolean {
        const currentNerve = this.spine.getCurrentNerve();

        // Already moving, nothing to do...
        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart)
            return true;

        return false;
    }

    private restartAtEnd(): void {
        if (this.moveStopType === MoveStopType.OnceAndWait) {
            this.spine.setNerve(MapPartsRailMoverNrv.Wait);
        } else if (this.moveStopType === MoveStopType.Mirror) {
            if (hasMapPartsMoveStartSignMotion(this.signMotionType))
                this.spine.setNerve(MapPartsRailMoverNrv.MoveStart);
            else
                this.spine.setNerve(MapPartsRailMoverNrv.Move);
        } else if (this.moveStopType === MoveStopType.Loop) {
            moveCoordToStartPos(this.actor);
            getRailPos(this.actor.translation, this.actor);
            this.spine.setNerve(MapPartsRailMoverNrv.Move);
        } else if (this.moveStopType === MoveStopType.OnceAndVanish) {
            this.spine.setNerve(MapPartsRailMoverNrv.Vanish);
        }
    }
}
