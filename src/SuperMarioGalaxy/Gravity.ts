
import { vec3, mat4 } from "gl-matrix";
import { JMapInfoIter, getJMapInfoBool, getJMapInfoScale, getJMapInfoArg0, getJMapInfoArg1 } from "./JMapInfo";
import { SceneObjHolder, getObjectName, SceneObj } from "./Main";
import { LiveActor, ZoneAndLayer, getJMapInfoTrans, getJMapInfoRotate } from "./LiveActor";
import { fallback, assertExists, nArray } from "../util";
import { computeModelMatrixR, computeModelMatrixSRT, MathConstants, getMatrixAxisX, getMatrixAxisY, getMatrixTranslation, isNearZeroVec3, isNearZero } from "../MathHelpers";
import { setTrans, calcMtxAxis, calcPerpendicFootToLineInside } from "./ActorUtil";
import { NameObj } from "./NameObj";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchMatrix = mat4.create();

export class GravityInfo {
    public direction: vec3 = vec3.create();
    public priority: number;
    public gravity: PlanetGravity;
}

const scratchGravTotal = vec3.create();
const scratchGravLocal = vec3.create();
export class PlanetGravityManager extends NameObj {
    private gravities: PlanetGravity[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'PlanetGravityManager');
    }

    public calcTotalGravityVector(dst: vec3 | null, gravityInfo: GravityInfo | null, coord: vec3, gravityTypeMask: GravityTypeMask, attachmentFilter: any): boolean {
        let bestPriority = -1;
        let bestMag = 0;
        vec3.set(scratchGravTotal, 0, 0, 0);

        for (let i = 0; i < this.gravities.length; i++) {
            const gravity = this.gravities[i];

            // TODO(jstpierre): Check gravity alive-ness
            // TODO(jstpierre): Check gravity attachment

            if (!(gravity.typeMask & gravityTypeMask))
                continue;

            if (gravity.priority < bestPriority)
                continue;

            if (!gravity.calcGravity(scratchGravLocal, coord))
                continue;

            const mag = vec3.length(scratchGravLocal);
            if (gravity.priority === bestPriority) {
                // Combine the two.
                vec3.add(scratchGravTotal, scratchGravTotal, scratchGravLocal);
            } else {
                // Overwrite with the new best gravity.
                vec3.copy(scratchGravTotal, scratchGravLocal);
                bestPriority = gravity.priority;
            }

            if (gravityInfo !== null && mag < bestMag) {
                vec3.copy(gravityInfo.direction, scratchGravLocal);
                gravityInfo.gravity = gravity;
                gravityInfo.priority = gravity.priority;
            }
        }

        if (dst !== null)
            vec3.normalize(dst, scratchGravTotal);

        return bestPriority >= 0;
    }

    public registerGravity(gravity: PlanetGravity): void {
        // TODO(jstpierre): Sort by priority
        this.gravities.push(gravity);
    }
}

function registerGravity(sceneObjHolder: SceneObjHolder, gravity: PlanetGravity): void {
    sceneObjHolder.create(SceneObj.PlanetGravityManager);
    sceneObjHolder.planetGravityManager!.registerGravity(gravity);
}

export const enum GravityTypeMask {
    Normal = 0x01,
    Shadow = 0x02,
    Magnet = 0x04,
}
const enum GravityPower { Light, Normal, Heavy }

abstract class PlanetGravity {
    public range: number = -1.0;
    public distant: number = 0.0;
    public priority: number = 0.0;
    public id: number = -1;
    public typeMask: GravityTypeMask = GravityTypeMask.Normal;
    public power: GravityPower = GravityPower.Normal;
    public inverse: boolean = false;

    public calcGravity(dst: vec3, coord: vec3): boolean {
        let distance = this.calcOwnGravityVector(dst, coord);
        if (distance < 0)
            return false;

        distance = Math.max((distance - this.distant), 1.0);
        const mag = 4000000.0 / (distance * distance);
        vec3.scale(dst, dst, mag);

        if (this.inverse)
            vec3.negate(dst, dst);

        return true;
    }

    protected calcGravityFromMassPosition(dst: vec3, p0: vec3, p1: vec3): number {
        vec3.subtract(dst, p1, p0);
        const dist = vec3.length(dst);
        if (this.isInRangeDistance(dist)) {
            vec3.normalize(dst, dst);
            return dist;
        } else {
            return -1;
        }
    }

    protected isInRangeDistance(distance: number): boolean {
        if (this.range < 0.0)
            return true;

        return (distance - this.distant) < this.range;
    }

    protected abstract calcOwnGravityVector(dst: vec3, coord: vec3): number;

    // TODO(jstpierre): I don't think this is ever called with a non-identity matrix, so I'm excluding
    // the parameter for now...
    protected updateMtx(): void {
    }

    public updateIdentityMtx(): void {
        this.updateMtx();
        // mat4.identity(scratchMatrix);
        // this.updateMtx(scratchMatrix);
    }
}

function settingGravityParamFromJMap(gravity: PlanetGravity, infoIter: JMapInfoIter): void {
    const range = infoIter.getValueNumberNoInit('Range');
    if (range !== null)
        gravity.range = range;

    const distant = infoIter.getValueNumberNoInit('Distant');
    if (distant !== null)
        gravity.distant = distant;

    const priority = infoIter.getValueNumberNoInit('Priority');
    if (priority !== null)
        gravity.priority = priority;

    const gravity_id = infoIter.getValueNumberNoInit('Gravity_id');
    if (gravity_id !== null)
        gravity.id = gravity_id;

    const gravity_type = infoIter.getValueString('Gravity_type');
    if (gravity_type !== null) {
        if (gravity_type === 'Normal')
            gravity.typeMask = GravityTypeMask.Normal;
        else if (gravity_type === 'Shadow')
            gravity.typeMask = GravityTypeMask.Shadow;
        else if (gravity_type === 'Magnet')
            gravity.typeMask = GravityTypeMask.Magnet;
    }

    const power = infoIter.getValueString('Power');
    if (power !== null) {
        if (power === 'Light')
            gravity.power = GravityPower.Light;
        else if (power === 'Normal')
            gravity.power = GravityPower.Normal;
        else if (power === 'Heavy')
            gravity.power = GravityPower.Heavy;
    }

    const inverse = infoIter.getValueNumberNoInit('Inverse');
    if (inverse !== null)
        gravity.inverse = getJMapInfoBool(inverse);
}

const enum ParallelGravityRangeType { Sphere, Box, Cylinder }

class ParallelGravity extends PlanetGravity {
    private rangeType = ParallelGravityRangeType.Sphere;
    private baseDistance: number = 2000;
    private cylinderRangeScaleX: number;
    private cylinderRangeScaleY: number;
    private boxMtx: mat4 | null = null;
    private boxExtentsSq: vec3 | null = null;
    private planeNormal = vec3.create();
    private planeTranslation = vec3.create();
    private distanceCalcType: number = -1;

    public setPlane(normal: vec3, translation: vec3): void {
        vec3.normalize(this.planeNormal, normal);
        vec3.copy(this.planeTranslation, translation);
    }

    public setBaseDistance(v: number): void {
        this.baseDistance = v;
    }

    public setDistanceCalcType(v: number): void {
        this.distanceCalcType = v;
    }

    public setRangeType(rangeType: ParallelGravityRangeType): void {
        this.rangeType = rangeType;
    }

    public setRangeCylinder(scaleX: number, scaleY: number): void {
        this.cylinderRangeScaleX = scaleX;
        this.cylinderRangeScaleY = scaleY;
    }

    public setRangeBox(mtx: mat4): void {
        this.boxMtx = mat4.clone(mtx);
    }

    protected updateMtx(): void {
        if (this.rangeType === ParallelGravityRangeType.Box) {
            const boxMtx = assertExists(this.boxMtx);
            this.boxExtentsSq = vec3.create();

            calcMtxAxis(scratchVec3a, scratchVec3b, scratchVec3c, boxMtx);
            this.boxExtentsSq[0] = vec3.squaredLength(scratchVec3a);
            this.boxExtentsSq[1] = vec3.squaredLength(scratchVec3b);
            this.boxExtentsSq[2] = vec3.squaredLength(scratchVec3c);
        }
    }

    private isInSphereRange(coord: vec3): number {
        if (this.range >= 0) {
            const distSq = vec3.squaredDistance(this.planeTranslation, coord);
            if (distSq < this.range*this.range)
                return this.baseDistance;
            else
                return -1;
        } else {
            return this.baseDistance;
        }
    }

    private isInBoxRange(coord: vec3): number {
        // Put in local space
        const boxMtx = this.boxMtx!;
        mat4.getTranslation(scratchVec3a, boxMtx);
        vec3.subtract(scratchVec3a, coord, scratchVec3a);

        const extentsSq = this.boxExtentsSq!;

        calcMtxAxis(scratchVec3b, null, null, boxMtx);
        const dotX = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotX < -extentsSq[0] || dotX > extentsSq[0])
            return -1;

        calcMtxAxis(null, scratchVec3b, null, boxMtx);
        const dotY = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotY < -extentsSq[1] || dotY > extentsSq[1])
            return -1;

        calcMtxAxis(null, null, scratchVec3b, boxMtx);
        const dotZ = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotZ < -extentsSq[2] || dotZ > extentsSq[2])
            return -1;

        if (this.distanceCalcType === -1)
            return this.baseDistance;
        else if (this.distanceCalcType === 0)
            return this.baseDistance + (Math.abs(dotX) / Math.sqrt(extentsSq[0]));
        else if (this.distanceCalcType === 1)
            return this.baseDistance + (Math.abs(dotY) / Math.sqrt(extentsSq[1]));
        else if (this.distanceCalcType === 2)
            return this.baseDistance + (Math.abs(dotZ) / Math.sqrt(extentsSq[2]));
        else
            throw "whoops";
    }

    private isInCylinderRange(coord: vec3): number {
        vec3.subtract(scratchVec3a, coord, this.planeTranslation);
        const dot = vec3.dot(this.planeNormal, this.planeTranslation);

        if (dot < 0 || dot > this.cylinderRangeScaleY)
            return -1;

        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, this.planeNormal, -dot);
        const mag = vec3.length(scratchVec3a);
        if (mag > this.cylinderRangeScaleX)
            return -1;

        return this.baseDistance + mag;
    }

    private isInRange(coord: vec3): number {
        if (this.rangeType === ParallelGravityRangeType.Sphere)
            return this.isInSphereRange(coord);
        else if (this.rangeType === ParallelGravityRangeType.Box)
            return this.isInBoxRange(coord);
        else if (this.rangeType === ParallelGravityRangeType.Cylinder)
            return this.isInCylinderRange(coord);
        else
            throw "whoops";
    }

    protected calcOwnGravityVector(dst: vec3, coord: vec3): number {
        const distance = this.isInRange(coord);
        if (distance < 0)
            return -1;

        vec3.negate(dst, this.planeNormal);
        return distance;
    }
}

class PointGravity extends PlanetGravity {
    public pos = vec3.create();

    protected calcOwnGravityVector(dst: vec3, coord: vec3): number {
        vec3.sub(dst, this.pos, coord);

        const mag = vec3.length(dst);
        vec3.normalize(dst, dst);
        if (!this.isInRangeDistance(mag))
            return -1;

        return mag;
    }
}

class SegmentGravity extends PlanetGravity {
    private gravityPoints = nArray(2, () => vec3.create());
    private sideVector = vec3.create();
    private sideDegreeVector = vec3.create();
    private edgeValid = nArray(2, () => true);
    private validSideDegree: number = 360.0;
    private validSideCos: number = -1.0;
    private segmentDirection = vec3.create();
    private segmentLength: number = 0;

    public setGravityPoint(i: number, v: vec3): void {
        vec3.copy(this.gravityPoints[i], v);
    }

    public setSideVector(v: vec3): void {
        vec3.normalize(this.sideVector, v);
    }

    public setValidSideDegree(v: number): void {
        this.validSideDegree = v;
    }

    public setEdgeValid(i: number, v: boolean): void {
        this.edgeValid[i] = v;
    }

    private updateLocalParam(): void {
        const theta = MathConstants.DEG_TO_RAD * this.validSideDegree * 0.5;
        this.validSideCos = Math.cos(theta);

        vec3.sub(scratchVec3a, this.gravityPoints[1], this.gravityPoints[0]);
        vec3.normalize(scratchVec3a, scratchVec3a);

        // TODO(jstpierre): Quite sure this will be orthonormal, so not sure why it's doing all this work...
        // dot should always be 0, right?
        const dot = vec3.dot(scratchVec3a, this.sideVector);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3a, this.sideVector, -dot);

        mat4.fromRotation(scratchMatrix, theta, scratchVec3a);
        vec3.transformMat4(this.sideDegreeVector, scratchVec3b, scratchMatrix);
    }

    protected updateMtx(): void {
        this.updateLocalParam();

        vec3.subtract(scratchVec3a, this.gravityPoints[1], this.gravityPoints[0]);
        this.segmentLength = vec3.length(scratchVec3a);
        vec3.normalize(this.segmentDirection, scratchVec3a);
    }

    protected calcOwnGravityVector(dst: vec3, coord: vec3): number {
        vec3.subtract(scratchVec3a, coord, this.gravityPoints[0]);
        const dot = vec3.dot(scratchVec3a, this.segmentDirection);

        if (this.validSideCos > -1 && vec3.squaredLength(this.sideDegreeVector) >= 0.0) {
            vec3.scale(scratchVec3b, this.segmentDirection, dot);
            vec3.sub(scratchVec3b, scratchVec3b, scratchVec3a);
            if (vec3.dot(scratchVec3b, this.sideDegreeVector) < this.validSideCos)
                return -1;
        }

        // There's code in here to test against some sort of distance, but from what I can tell, it's never set...

        if (dot >= 0 && dot <= this.segmentLength) {
            vec3.scaleAndAdd(scratchVec3b, this.gravityPoints[0], this.segmentDirection, dot);
        } else if (dot >= 0) {
            if (!this.edgeValid[1])
                return -1;

            vec3.copy(scratchVec3b, this.gravityPoints[1]);
        } else {
            if (!this.edgeValid[0])
                return -1;

            vec3.copy(scratchVec3b, this.gravityPoints[0]);
        }

        vec3.sub(scratchVec3a, scratchVec3b, coord);
        const dist = vec3.length(scratchVec3a);
        if (!this.isInRangeDistance(dist))
            return -1;

        vec3.normalize(dst, scratchVec3a);
        return dist;
    }
}

class ConeGravity extends PlanetGravity {
    public enableBottom: boolean = false;
    public topCutRate: number = 0.0;
    private mtx = mat4.create();
    private magX: number;

    public setEnableBottom(v: boolean): void {
        this.enableBottom = v;
    }

    public setTopCutRate(v: number): void {
        this.topCutRate = v;
    }

    public setLocalMatrix(m: mat4): void {
        mat4.copy(this.mtx, m);
    }

    protected updateMtx(): void {
        getMatrixAxisX(scratchVec3a, this.mtx);
        this.magX = vec3.length(scratchVec3a);
    }

    protected calcOwnGravityVector(dst: vec3, coord: vec3): number {
        getMatrixAxisY(scratchVec3a, this.mtx);
        const height = vec3.length(scratchVec3a);
        vec3.normalize(scratchVec3a, scratchVec3a);

        getMatrixTranslation(scratchVec3b, this.mtx);
        vec3.sub(scratchVec3b, coord, scratchVec3b);

        // Project the position around the cone onto the cone's Y axis.
        const dot = vec3.dot(scratchVec3a, scratchVec3b);
        vec3.scaleAndAdd(scratchVec3d, scratchVec3b, scratchVec3a, -dot);

        if (!isNearZeroVec3(scratchVec3d, 0.001)) {
            const dist = vec3.length(scratchVec3d);

            vec3.add(scratchVec3a, scratchVec3b, scratchVec3a);
            vec3.scaleAndAdd(scratchVec3c, scratchVec3b, scratchVec3d, this.magX / dist);

            if (dot >= 0.0) {
                // Top of the cone.
                if (this.topCutRate >= 0.01) {
                    // TODO(jstpierre): Top cut...
                    calcPerpendicFootToLineInside(scratchVec3b, coord, scratchVec3c, scratchVec3a);
                } else {
                    calcPerpendicFootToLineInside(scratchVec3b, coord, scratchVec3c, scratchVec3a);
                }

                vec3.sub(scratchVec3a, scratchVec3b, coord);
                if (!isNearZeroVec3(scratchVec3a, 0.001)) {
                    if (!isNearZero(height, 0.001) && !isNearZero(this.magX, 0.001) && dist < (this.magX - (dot * (this.magX / height)))) {
                        // On surface.
                        vec3.sub(dst, coord, scratchVec3b);
                        vec3.normalize(dst, dst);
                        return 0.0;
                    } else {
                        return this.calcGravityFromMassPosition(dst, coord, scratchVec3a);
                    }
                } else {
                    vec3.sub(scratchVec3b, scratchVec3b, scratchVec3c);
                    vec3.normalize(scratchVec3b, scratchVec3b);
                    vec3.negate(scratchVec3d, scratchVec3d);
                    const dot = vec3.dot(scratchVec3b, scratchVec3d);
                    vec3.scaleAndAdd(scratchVec3b, scratchVec3d, scratchVec3b, -dot);
                    if (!isNearZeroVec3(scratchVec3b, 0.001)) {
                        vec3.normalize(dst, scratchVec3b);
                    } else {
                        vec3.negate(dst, scratchVec3a);
                    }
                    return 0.0;
                }
            } else {
                // Bottom of the cone.

                if (this.enableBottom) {
                    getMatrixTranslation(scratchVec3b, this.mtx);
                    calcPerpendicFootToLineInside(scratchVec3b, coord, scratchVec3b, scratchVec3c);
                    vec3.sub(scratchVec3c, scratchVec3b, coord);
                    if (!isNearZeroVec3(scratchVec3c, 0.001)) {
                        return this.calcGravityFromMassPosition(dst, coord, scratchVec3a);
                    } else {
                        vec3.negate(dst, scratchVec3a);
                        return 0.0;
                    }
                } else {
                    return -1;
                }
            }
        } else {
            let dist = Math.abs(dot);

            if (dot > 0.0) {
                // Top of the cone.
                dist = Math.max(0.0, dist - (height * (1.0 - this.topCutRate)));
            }

            if (this.isInRangeDistance(dist)) {
                vec3.scale(dst, scratchVec3a, dot > 0.0 ? -1 : 1);
                return dist;
            } else {
                return -1;
            }
        }
    }
}

export class GlobalGravityObj extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, public gravity: PlanetGravity) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
    }
}

function makeMtxTR(dst: mat4, translation: vec3, rotation: vec3): void {
    computeModelMatrixSRT(dst,
        1, 1, 1,
        rotation[0], rotation[1], rotation[2],
        translation[0], translation[1], translation[2]);
}

function makeMtxTRS(dst: mat4, translation: vec3, rotation: vec3, scale: vec3): void {
    computeModelMatrixSRT(dst,
        scale[0], scale[1], scale[2],
        rotation[0], rotation[1], rotation[2],
        translation[0], translation[1], translation[2]);
}

function preScaleMtx(dst: mat4, x: number, y: number, z: number): void {
    dst[0] *= x;
    dst[1] *= x;
    dst[2] *= x;
    dst[4] *= y;
    dst[5] *= y;
    dst[6] *= y;
    dst[8] *= z;
    dst[9] *= z;
    dst[10] *= z;
}

export function createGlobalPlaneGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ParallelGravity();

    // PlaneGravityCreator::settingFromSRT
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    calcMtxAxis(null, scratchVec3a, null, scratchMatrix);
    gravity.setPlane(scratchVec3a, scratchVec3b);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalPlaneInBoxGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ParallelGravity();
    gravity.setRangeType(ParallelGravityRangeType.Box);

    // PlaneInBoxGravityCreator::settingFromSRT
    getJMapInfoScale(scratchVec3a, infoIter);
    vec3.scale(scratchVec3a, scratchVec3a, 500);

    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3c, sceneObjHolder, infoIter);
    makeMtxTR(scratchMatrix, scratchVec3b, scratchVec3c);
    calcMtxAxis(null, scratchVec3c, null, scratchMatrix);
    gravity.setPlane(scratchVec3c, scratchVec3b);

    vec3.scaleAndAdd(scratchVec3c, scratchVec3b, scratchVec3c, scratchVec3a[1]);
    setTrans(scratchMatrix, scratchVec3c);
    preScaleMtx(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    gravity.setRangeBox(scratchMatrix);

    // PlaneInBoxGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    if (arg0 >= 0)
        gravity.setBaseDistance(arg0);

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    if (arg1 !== -1)
        gravity.setDistanceCalcType(arg1);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalPointGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new PointGravity();

    // PointGravityCreator::settingFromSRT
    getJMapInfoTrans(gravity.pos, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3a, infoIter);
    gravity.distant = 500.0 * scratchVec3a[0];

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalSegmentGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new SegmentGravity();

    // SegmentGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTRS(scratchMatrix, scratchVec3a, scratchVec3b, scratchVec3c);
    calcMtxAxis(scratchVec3b, scratchVec3c, null, scratchMatrix);
    gravity.setGravityPoint(0, scratchVec3a);
    vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, 1000.0);
    gravity.setGravityPoint(1, scratchVec3a);
    gravity.setSideVector(scratchVec3b);

    // SegmentGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    if (arg0 === 0) {
        gravity.setEdgeValid(0, false);
        gravity.setEdgeValid(1, false);
    } else if (arg0 === 1) {
        gravity.setEdgeValid(0, true);
        gravity.setEdgeValid(1, false);
    } else if (arg0 === 2) {
        gravity.setEdgeValid(0, false);
        gravity.setEdgeValid(1, true);
    } else if (arg0 === 3) {
        gravity.setEdgeValid(0, true);
        gravity.setEdgeValid(1, true);
    }

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    if (arg1 >= 0)
        gravity.setValidSideDegree(arg1);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalConeGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ConeGravity();

    // ConeGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTRS(scratchMatrix, scratchVec3a, scratchVec3b, scratchVec3c);
    gravity.setLocalMatrix(scratchMatrix);

    // ConeGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    gravity.setEnableBottom(arg0 !== 0);

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    gravity.setTopCutRate(arg1 / 1000.0);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}
