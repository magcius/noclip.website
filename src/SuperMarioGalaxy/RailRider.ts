
import { JMapInfoIter } from "./JMapInfo";
import { vec3 } from "gl-matrix";
import { SceneObjHolder } from "./Main";
import { assertExists, assert, fallback } from "../util";
import { clamp, isNearZero, isNearZeroVec3 } from "../MathHelpers";
import { LiveActor } from "./LiveActor";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Camera } from "../Camera";
import { Magenta } from "../Color";

function getRailPointPos(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, prefix: string): void {
    dst[0] = fallback(infoIter.getValueNumber(`${prefix}_x`), 0);
    dst[1] = fallback(infoIter.getValueNumber(`${prefix}_y`), 0);
    dst[2] = fallback(infoIter.getValueNumber(`${prefix}_z`), 0);

    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    vec3.transformMat4(dst, dst, stageDataHolder.placementMtx);
}

// Some words on the conventions used by Nintendo:
//  - "param" is a normalized time from 0 - 1.
//  - "coord" is a normalized time from 0 - length.
//  - calcVelocity() appears to actually calculate a derivative of the path.

const scratchVec3a = vec3.create();
class LinearRailPart {
    public p0: vec3 = vec3.create();
    private p3: vec3 = vec3.create();
    private length: number;

    constructor(p0: vec3, p3: vec3) {
        vec3.copy(this.p0, p0);
        vec3.sub(this.p3, p3, p0);
        this.length = vec3.length(this.p3);
    }

    public calcPos(dst: vec3, param: number): void {
        vec3.scaleAndAdd(dst, this.p0, this.p3, param);
    }

    public calcVelocity(dst: vec3, param: number): void {
        vec3.copy(dst, this.p3);
    }

    public getLength(param0: number, param1: number): number {
        return this.length * (param1 - param0);
    }

    public getTotalLength(): number {
        return this.length;
    }

    public getNearestParam(v: vec3, n: number): number {
        // Project v onto the line p0...p3
        vec3.subtract(scratchVec3a, v, this.p0);
        const proj = vec3.dot(scratchVec3a, this.p3);
        // ..and normalize.
        const scale = vec3.squaredLength(this.p3);
        return clamp(proj / scale, 0.0, 1.0);
    }

    public getParam(coord: number): number {
        return coord / this.length;
    }
}

class BezierRailPart {
    public p0: vec3 = vec3.create();
    private p1: vec3 = vec3.create();
    private p2: vec3 = vec3.create();
    private p3: vec3 = vec3.create();
    private length: number;

    constructor(p0: vec3, p1: vec3, p2: vec3, p3: vec3) {
        vec3.copy(this.p0, p0);
        vec3.sub(this.p1, p1, p0);
        vec3.sub(this.p2, p2, p1);
        vec3.sub(this.p3, p3, p2);

        // Put in relative spaces.
        vec3.sub(this.p3, this.p3, this.p2);
        vec3.sub(this.p2, this.p2, this.p1);
        vec3.sub(this.p3, this.p3, this.p2);

        this.length = this.getLength(0.0, 1.0);
    }

    public calcPos(dst: vec3, param: number): void {
        vec3.copy(dst, this.p0);
        vec3.scaleAndAdd(dst, dst, this.p1, 3 * param);
        vec3.scaleAndAdd(dst, dst, this.p2, 3 * param * param);
        vec3.scaleAndAdd(dst, dst, this.p3, param * param * param);
    }

    public calcVelocity(dst: vec3, param: number): void {
        vec3.copy(dst, this.p1);
        vec3.scaleAndAdd(dst, dst, this.p2, 2 * param);
        vec3.scaleAndAdd(dst, dst, this.p3, param * param);
        vec3.scale(dst, dst, 3);
    }

    public getLength(param0: number, param1: number, numParts: number = 10): number {
        let length0 = 0;
        let length1 = 0;

        let idx = 2;
        const inv = (param1 - param0) * (1 / (2*numParts));
        for (let i = 1; i <= numParts; i++) {
            this.calcVelocity(scratchVec3a, (param0 + inv * (idx - 1)));
            length0 += vec3.length(scratchVec3a);

            if (i < numParts) {
                this.calcVelocity(scratchVec3a, (param0 + inv * (idx)));
                length1 += vec3.length(scratchVec3a);
            }

            idx += 2;
        }

        this.calcVelocity(scratchVec3a, param0);
        const p0Mag = vec3.length(scratchVec3a);
        this.calcVelocity(scratchVec3a, param1);
        const p1Mag = vec3.length(scratchVec3a);

        return (1/3) * (inv * ((4.0 * length0) + (0.5 * (p0Mag + p1Mag)) + (2.0 * length1)));
    }

    public getTotalLength(): number {
        return this.length;
    }

    public getNearestParam(v: vec3, step: number): number {
        let nearest = -1;
        let mindist = Infinity;
        for (let i = 0; i <= 1.0; i += step) {
            this.calcPos(scratchVec3a, i);
            const sqdist = vec3.squaredDistance(v, scratchVec3a);
            if (sqdist < mindist) {
                nearest = i;
                mindist = sqdist;
            }
        }
        return nearest;
    }

    public getParam(coord: number): number {
        let t = coord / this.length;
        let coordIter = this.getLength(0, t);

        // Iterative refinement.
        if (Math.abs(coord - coordIter) > 0.01) {
            for (let i = 0; i < 5; i++) {
                this.calcVelocity(scratchVec3a, t);
                const mag = vec3.length(scratchVec3a);
                t = clamp(t + (coord - coordIter) / mag, 0.0, 1.0);
                coordIter = this.getLength(0, t);
                if (Math.abs(coord - coordIter) < 0.01)
                    break;
            }

            if (coordIter < 0 || t > 1)
                t = clamp(t, 0.0, 1.0);
        }

        return t;
    }
}

type RailPart = LinearRailPart | BezierRailPart;

function equalEpsilon(a: number, b: number, ep: number): boolean {
    if ((a - b) < -ep)
        return false;
    if ((a - b) > ep)
        return false;
    return true;
}

function equalEpsilonVec3(a: vec3, b: vec3, ep: number): boolean {
    return equalEpsilon(a[0], b[0], ep) && equalEpsilon(a[1], b[1], ep) && equalEpsilon(a[2], b[2], ep);
}

function makeRailPart(p0: vec3, p1: vec3, p2: vec3, p3: vec3): RailPart {
    if (equalEpsilonVec3(p0, p1, 0.01) && equalEpsilonVec3(p2, p3, 0.01))
        return new LinearRailPart(p0, p3);
    else
        return new BezierRailPart(p0, p1, p2, p3);
}

export class BezierRail {
    private pointRecordCount: number;
    public isClosed: boolean;
    public railParts: RailPart[] = [];
    public railPartCoords: number[] = [];
    public railIter: JMapInfoIter;

    constructor(sceneObjHolder: SceneObjHolder, railIter: JMapInfoIter, private pointsInfo: JMapInfoIter) {
        this.isClosed = railIter.getValueString('closed') === 'CLOSE';

        this.railIter = new JMapInfoIter(railIter.bcsv, railIter.record);

        this.pointRecordCount = pointsInfo.getNumRecords();
        const railPartCount = this.isClosed ? this.pointRecordCount : this.pointRecordCount - 1;

        const p0 = vec3.create();
        const p1 = vec3.create();
        const p2 = vec3.create();
        const p3 = vec3.create();

        let totalLength = 0;
        for (let i = 0; i < railPartCount; i++) {
            const i0 = i;
            const i1 = (i + 1) % this.pointRecordCount;

            pointsInfo.setRecord(i0);
            assert(pointsInfo.getValueNumber('id') === i0);
            getRailPointPos(p0, sceneObjHolder, pointsInfo, `pnt0`);
            getRailPointPos(p1, sceneObjHolder, pointsInfo, `pnt2`);
            pointsInfo.setRecord(i1);
            getRailPointPos(p2, sceneObjHolder, pointsInfo, `pnt1`);
            getRailPointPos(p3, sceneObjHolder, pointsInfo, `pnt0`);

            const railPart = makeRailPart(p0, p1, p2, p3);
            this.railParts.push(railPart);

            const partLength = railPart.getTotalLength();
            totalLength += partLength;
            this.railPartCoords.push(totalLength);
        }
    }

    public calcRailCtrlPointIter(idx: number): JMapInfoIter {
        this.pointsInfo.setRecord(idx);
        return this.pointsInfo;
    }

    public getRailPosCoord(m: number): number {
        if (m === 0)
            return 0;
        else if (!this.isClosed && m === this.pointRecordCount)
            return this.getTotalLength();
        else
            return this.railPartCoords[m - 1];
    }

    public getTotalLength(): number {
        return this.railPartCoords[this.railPartCoords.length - 1];
    }

    public getNearestRailPosCoord(v: vec3): number {
        let maxdist = Infinity;
        let coord = -1;
        let idx = -1;

        for (let i = 0; i < this.railParts.length; i++) {
            const part = this.railParts[i];
            const partLength = part.getTotalLength();
            const h = part.getNearestParam(v, 100 / partLength);
            part.calcPos(scratchVec3a, h);
            const sqdist = vec3.squaredDistance(scratchVec3a, v);
            if (sqdist < maxdist) {
                maxdist = sqdist;
                coord = h;
                idx = i;
            }
        }

        return this.getRailPosCoord(idx) + this.railParts[idx].getLength(0, coord);
    }

    public normalizePos(v: number, n: number): number {
        if (this.isClosed) {
            const length = this.getTotalLength();
            let coord = v % length;
            if (n < 0 && isNearZero(coord, 0.001))
                coord = length;
            if (coord < 0.0)
                coord += length;
            return coord;
        } else {
            return clamp(v, 0.0, this.getTotalLength());
        }
    }

    public getIncludedSectionIdx(coord: number, n: number): number {
        coord = this.normalizePos(coord, n);

        if (n < 1) {
            // TODO
            assert(false);
        } else {
            for (let i = 0; i < this.railParts.length; i++) {
                if (coord < this.railPartCoords[i] || i === this.railParts.length - 1)
                    return i;
            }
        }

        // Should be unreachable.
        throw "whoops";
    }

    public getCurrentCtrlPointIndex(coord: number, direction: RailDirection): number {
        coord = this.normalizePos(coord, direction === RailDirection.TOWARDS_START ? -1 : 1);

        if (isNearZero(coord, 0.001))
            return 0;
        if (isNearZero(this.getTotalLength() - coord, 0.001))
            return this.isClosed ? this.pointRecordCount - 1 : 0;

        if (direction === RailDirection.TOWARDS_END) {
            for (let i = 0; i < this.railPartCoords.length; i++)
                if (coord < this.railPartCoords[i])
                    return i;
        } else {
            // TODO(jstpierre): No part of this seems right...
            for (let i = this.railPartCoords.length - 1; i >= 0; i--) {
                const railPartCoord = i === 0 ? 0 : this.railPartCoords[i - 1];
                if (coord > railPartCoord && coord <= this.railPartCoords[i])
                    return (i + 1) - (((i + 1) / this.pointRecordCount) | 0) * this.pointRecordCount;
            }
        }

        // Should never happen.
        throw "whoops";
    }

    private getCoordForRailPartIdx(railPartIdx: number, coord: number): number {
        const railPartCoordStart = railPartIdx > 0 ? this.railPartCoords[railPartIdx - 1] : 0;
        const railPart = this.railParts[railPartIdx];
        return clamp(coord - railPartCoordStart, 0, railPart.getTotalLength());
    }

    public calcRailDirection(dst: vec3, part: RailPart, param: number): void {
        part.calcVelocity(dst, param);
        if (!isNearZeroVec3(dst, 0.001)) {
            let p0: number, p1: number;
            if (param >= 0.5) {
                p0 = param - 0.1;
                p1 = param;
            } else {
                p0 = param;
                p1 = param + 0.1;
            }

            part.calcPos(scratchVec3a, p0);
            part.calcPos(dst, p1);
            vec3.sub(dst, dst, scratchVec3a);
        }

        vec3.normalize(dst, dst);
    }

    public calcPosDir(dstPos: vec3, dstDir: vec3, coord: number): void {
        const partIdx = this.getIncludedSectionIdx(coord, 1);
        const part = this.railParts[partIdx];
        const partParam = part.getParam(this.getCoordForRailPartIdx(partIdx, coord));
        part.calcPos(dstPos, partParam);
        this.calcRailDirection(dstDir, part, partParam);
    }

    public calcPos(dst: vec3, coord: number): void {
        const partIdx = this.getIncludedSectionIdx(coord, 1);
        const part = this.railParts[partIdx];
        const partParam = part.getParam(this.getCoordForRailPartIdx(partIdx, coord));
        part.calcPos(dst, partParam);
    }

    public calcDirection(dst: vec3, coord: number): void {
        const partIdx = this.getIncludedSectionIdx(coord, 1);
        const part = this.railParts[partIdx];
        const partParam = part.getParam(this.getCoordForRailPartIdx(partIdx, coord));
        this.calcRailDirection(dst, part, partParam);
    }

    public getPartLength(partIdx: number): number {
        return this.railParts[partIdx].getTotalLength();
    }
}

export function getBezierRailForActor(sceneObjHolder: SceneObjHolder, actorIter: JMapInfoIter): BezierRail {
    assert(isConnectedWithRail(actorIter));
    const railId = assertExists(actorIter.getValueNumber('CommonPath_ID'));
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(actorIter)!;
    const [railIter, pointInfo] = stageDataHolder.getCommonPathPointInfo(railId);
    return new BezierRail(sceneObjHolder, railIter, pointInfo);
}

export function isConnectedWithRail(actorIter: JMapInfoIter) {
    return fallback(actorIter.getValueNumberNoInit('CommonPath_ID'), 0xFFFF) !== 0xFFFF;
}

export const enum RailDirection { TOWARDS_END, TOWARDS_START }

export class RailRider {
    public bezierRail: BezierRail;
    public currentPos = vec3.create();
    public currentDir = vec3.create();
    public currentPointId: number = -1;
    public coord: number = 0;
    public speed: number = 0;
    public direction: RailDirection = RailDirection.TOWARDS_END;
    public startPos = vec3.create();
    public endPos = vec3.create();

    constructor(sceneObjHolder: SceneObjHolder, private actor: LiveActor, actorIter: JMapInfoIter) {
        assert(isConnectedWithRail(actorIter));
        this.bezierRail = getBezierRailForActor(sceneObjHolder, actorIter);

        this.bezierRail.calcPos(this.startPos, 0.0);
        this.bezierRail.calcPos(this.endPos, this.getTotalLength());
    }

    private syncPosDir(): void {
        if (this.coord > 0.0 && this.coord < this.bezierRail.getTotalLength()) {
            this.bezierRail.calcPosDir(this.currentPos, this.currentDir, this.coord);
        } else if (this.coord === 0.0) {
            this.bezierRail.calcPos(this.currentPos, this.coord);
            this.bezierRail.calcDirection(this.currentDir, 0.1);
        } else {
            this.bezierRail.calcPos(this.currentPos, this.coord);
            this.bezierRail.calcDirection(this.currentDir, this.bezierRail.getTotalLength() - 0.1);
        }

        if (this.direction === RailDirection.TOWARDS_START)
            vec3.negate(this.currentDir, this.currentDir);

        this.currentPointId = this.bezierRail.getCurrentCtrlPointIndex(this.coord, this.direction);
    }

    private copyPointPos(v: vec3, m: number): void {
        vec3.copy(v, this.bezierRail.railParts[m].p0);
    }

    public moveToNearestPoint(v: vec3): void {
        let mindist = Infinity;
        let idx = 0;

        for (let i = 0; i < this.bezierRail.railParts.length; i++) {
            this.copyPointPos(scratchVec3a, i);
            const sqdist = vec3.squaredDistance(v, scratchVec3a);
            if (sqdist < mindist) {
                mindist = sqdist;
                idx = i;
            }
        }

        this.coord = this.bezierRail.getRailPosCoord(idx);
        this.syncPosDir();
    }

    public moveToNearestPos(v: vec3): void {
        this.coord = this.bezierRail.getNearestRailPosCoord(v);
        this.syncPosDir();
    }

    public setCoord(v: number): void {
        this.coord = this.bezierRail.normalizePos(v, 1);
        this.syncPosDir();
    }

    public setSpeed(v: number): void {
        this.speed = v;
    }

    public move(): void {
        if (this.direction === RailDirection.TOWARDS_END)
            this.coord += this.speed;
        else
            this.coord -= this.speed;

        this.coord = this.bezierRail.normalizePos(this.coord, 1);
        this.syncPosDir();
    }

    public reverse(): void {
        this.direction = this.direction === RailDirection.TOWARDS_END ? RailDirection.TOWARDS_START : RailDirection.TOWARDS_END;
        this.syncPosDir();
    }

    public getTotalLength(): number {
        return this.bezierRail.getTotalLength();
    }

    public isLoop(): boolean {
        return this.bezierRail.isClosed;
    }

    public calcPosAtCoord(dst: vec3, coord: number): void {
        this.bezierRail.calcPos(dst, coord);
    }

    public isReachedGoal(): boolean {
        // Closed rails loop forever...
        if (this.bezierRail.isClosed)
            return false;

        const dist = (this.direction === RailDirection.TOWARDS_END) ? this.getTotalLength() - this.coord : this.coord;
        return isNearZero(dist, 0.001);
    }

    public getCurrentPointArg(argName: string): number | null {
        const pointIter = this.bezierRail.calcRailCtrlPointIter(this.currentPointId);
        return pointIter.getValueNumberNoInit(argName);
    }

    public getPartLength(partIdx: number): number {
        return this.bezierRail.getPartLength(partIdx);
    }

    public debugDrawRail(camera: Camera, nPoints: number = 50): void {
        const totalLength = this.getTotalLength();
        const speed = totalLength / nPoints;
        const ctx = getDebugOverlayCanvas2D();
        for (let i = 0; i < nPoints; i++) {
            const coord = i * speed;
            this.bezierRail.calcPos(scratchVec3a, coord);
            drawWorldSpacePoint(ctx, camera, scratchVec3a, Magenta, 4);
            /*
            const partIdx = this.bezierRail.getIncludedSectionIdx(coord, 1);
            const part = this.bezierRail.railParts[partIdx];
            const param = part.getParam(this.bezierRail.getCoordForRailPartIdx(partIdx, coord));
            drawWorldSpaceText(ctx, camera, scratchVec3a, param.toFixed(2), Yellow);
            */
        }
    }
}
