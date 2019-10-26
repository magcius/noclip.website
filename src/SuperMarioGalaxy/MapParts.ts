
import { LiveActor } from './LiveActor';
import { assertExists } from '../util';
import { Spine } from './Spine';
import { NameObj } from './NameObj';
import { mat4, vec3 } from 'gl-matrix';
import { JMapInfoIter } from './JMapInfo';
import { computeModelMatrixR, MathConstants } from '../MathHelpers';
import { SceneObjHolder, getDeltaTimeFrames } from './Main';
import { ViewerRenderInput } from '../viewer';
import { RailDirection } from './RailRider';
import { moveCoordAndTransToNearestRailPos, moveCoordAndTransToNearestRailPoint, moveCoordAndTransToRailStartPoint, getRailCoord, setRailCoord, getRailPos } from './Actors';

function getMapPartsArgMoveConditionType(infoIter: JMapInfoIter): number {
    return assertExists(infoIter.getValueNumber('MoveConditionType'));
}

function getMapPartsArgSignMotionType(infoIter: JMapInfoIter): number {
    return assertExists(infoIter.getValueNumber('SignMotionType'));
}

function getMapPartsArgMoveStopType(actor: LiveActor): number {
    const railRider = assertExists(actor.railRider);
    return railRider.bezierRail.railIter.getValueNumber('path_arg1', 1);
}

const enum RailInitPosType {
    RAIL_POS,
    RAIL_POINT,
    RAIL_POINT0,
}

function getMapPartsArgRailInitPosType(actor: LiveActor): RailInitPosType {
    const railRider = assertExists(actor.railRider);
    return railRider.bezierRail.railIter.getValueNumber('path_arg4', 1);
}

const enum MapPartsRotatorNrv { NEVER_MOVE, WAIT, ROTATE_START, ROTATE, STOP_AT_END }

function hasMapPartsMoveStartSignMotion(signMotionType: number): boolean {
    // TODO(jstpierre)
    return false;
}

const enum AxisType { X, Y, Z }
const enum AccelType { NORMAL, REVERSE, TIMED }

const scratchVec3 = vec3.create();

// TODO(jstpierre): MapPartsFunction?
export class MapPartsRotator extends NameObj {
    private rotateAngle: number;
    private rotateAxis: AxisType;
    private rotateAccelType: AccelType;
    private rotateStopTime: number;
    private rotateType: number;
    private rotateSpeed: number;
    private signMotionType: number;
    private targetAngle: number = 0;
    private velocity: number = 0;
    private isOnReverse: boolean = false;
    private angle: number = 0;
    private spine: Spine;

    private baseHostMtx = mat4.create();
    public rotateMtx = mat4.create();

    constructor(private actor: LiveActor, infoIter: JMapInfoIter) {
        super('MapPartsRotator');

        this.spine = new Spine();

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
            this.spine.setNerve(MapPartsRotatorNrv.WAIT);
        } else {
            this.spine.setNerve(MapPartsRotatorNrv.NEVER_MOVE);
        }

        this.updateBaseHostMtx();
    }

    public isWorking(): boolean {
        return (
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.NEVER_MOVE &&
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.WAIT
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
        mat4.identity(this.rotateMtx);
        mat4.rotate(this.rotateMtx, this.rotateMtx, MathConstants.DEG_TO_RAD * this.angle, scratchVec3);
        mat4.mul(this.rotateMtx, this.rotateMtx, this.baseHostMtx);
    }

    public start(): void {
        this.updateTargetAngle();
        this.updateRotateMtx();
        this.spine.setNerve(MapPartsRotatorNrv.ROTATE);
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
                this.spine.setNerve(MapPartsRotatorNrv.ROTATE_START);
            else
                this.spine.setNerve(MapPartsRotatorNrv.ROTATE);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.spine.getCurrentNerve() === MapPartsRotatorNrv.ROTATE) {
            this.updateVelocity();
            this.updateAngle(getDeltaTimeFrames(viewerInput));

            if ((this.rotateAccelType === AccelType.NORMAL || this.rotateAccelType === AccelType.TIMED) && this.isReachedTargetAngle()) {
                this.angle = this.targetAngle;
                this.updateRotateMtx();

                if (this.rotateStopTime < 1)
                    this.restartAtEnd();
                else
                    this.spine.setNerve(MapPartsRotatorNrv.STOP_AT_END);
            } else {
                if (this.rotateAccelType === AccelType.REVERSE && this.velocity === 0)
                    this.spine.setNerve(MapPartsRotatorNrv.STOP_AT_END);
                else
                    this.updateRotateMtx();
            }
        }
    }
}

function isNearZero(v: number, min: number): boolean {
    return v > -min && v < min;
}

const enum MapPartsRailMoverNrv { WAIT, MOVE_START, MOVE }

export class MapPartsRailMover extends NameObj {
    private moveConditionType: number;
    private moveStopType: number;
    private signMotionType: number;
    private translation = vec3.create();
    private startRailCoord: number;
    private spine: Spine;

    constructor(private actor: LiveActor, infoIter: JMapInfoIter) {
        super('MapPartsRailMover');

        this.spine = new Spine();

        this.moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        this.moveStopType = getMapPartsArgMoveStopType(this.actor);
        this.signMotionType = getMapPartsArgSignMotionType(infoIter);

        const initPosType = getMapPartsArgRailInitPosType(this.actor);

        if (initPosType === RailInitPosType.RAIL_POS) {
            moveCoordAndTransToNearestRailPos(this.actor);
        } else if (initPosType === RailInitPosType.RAIL_POINT) {
            moveCoordAndTransToNearestRailPoint(this.actor);
        } else if (initPosType === RailInitPosType.RAIL_POINT0) {
            moveCoordAndTransToRailStartPoint(this.actor);
        }

        vec3.copy(this.translation, this.actor.translation);
        this.startRailCoord = getRailCoord(this.actor);

        this.spine.setNerve(MapPartsRailMoverNrv.WAIT);
    }

    public moveToInitPos(): void {
        if (isNearZero(this.startRailCoord - getRailCoord(this.actor), 0.001)) {
            setRailCoord(this.actor, this.startRailCoord);
            getRailPos(this.translation, this.actor);

            if (this.actor.railRider!.direction !== RailDirection.TOWARDS_END)
                this.actor.railRider!.reverse();
        }
    }

    public start(): void {
        this.moveToInitPos();

        if (hasMapPartsMoveStartSignMotion(this.signMotionType))
            this.spine.setNerve(MapPartsRailMoverNrv.MOVE_START);
        else
            this.spine.setNerve(MapPartsRailMoverNrv.MOVE);
    }
}
