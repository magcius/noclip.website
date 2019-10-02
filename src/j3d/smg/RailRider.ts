
import { JMapInfoIter } from "./JMapInfo";
import { vec3 } from "gl-matrix";
import { SceneObjHolder } from "./smg_scenes";
import { assertExists, assert } from "../../util";
import { clamp } from "../../MathHelpers";
import { LiveActor } from "./LiveActor";

function getRailPointPos(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, prefix: string): void {
    dst[0] = infoIter.getValueNumber(`${prefix}_x`, 0);
    dst[1] = infoIter.getValueNumber(`${prefix}_y`, 0);
    dst[2] = infoIter.getValueNumber(`${prefix}_z`, 0);

    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    vec3.transformMat4(dst, dst, stageDataHolder.placementMtx);
}

// Some words on the conventions used by Nintendo:
//  - "param" means what I consistently call "t", that is, normalized time from 0 - 1.
//  - getParam() takes what I call a "position", which a normalized time from 0 - length.
//  - calcVelocity() appears to actually calculate a derivative of the path.

const scratchVec3a = vec3.create();
class LinearRailPart {
    private p0: vec3 = vec3.create();
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

    public getParam(position: number): number {
        return position / this.length;
    }
}

class BezierRailPart {
    private p0: vec3 = vec3.create();
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

        return (1/3) * (inv * (4.0 * length0) + (0.5 * (p0Mag + p1Mag)) + (2.0 * length1));
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

    public getTotalLength(): number {
        return this.length;
    }
}

type RailPart = LinearRailPart | BezierRailPart;

function equalEpsilon(a: number, b: number, ep: number): boolean {
    return a - ep > b && a + ep < b;
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
    private railParts: RailPart[] = [];
    private isClosed: boolean;

    constructor(sceneObjHolder: SceneObjHolder, railIter: JMapInfoIter, pointsInfo: JMapInfoIter) {
        this.isClosed = railIter.getValueString('closed') === 'CLOSE';

        const numPointRecords = railIter.getNumRecords();
        const numRailParts = this.isClosed ? numPointRecords : numPointRecords - 1;

        const p0 = vec3.create();
        const p1 = vec3.create();
        const p2 = vec3.create();
        const p3 = vec3.create();

        for (let i = 0; i < numRailParts; i++) {
            const i0 = i;
            const i1 = (i + 1) % numPointRecords;

            pointsInfo.setRecord(i0);
            getRailPointPos(p0, sceneObjHolder, pointsInfo, `pnt0`);
            getRailPointPos(p1, sceneObjHolder, pointsInfo, `pnt2`);
            pointsInfo.setRecord(i1);
            getRailPointPos(p2, sceneObjHolder, pointsInfo, `pnt1`);
            getRailPointPos(p3, sceneObjHolder, pointsInfo, `pnt0`);

            const railPart = makeRailPart(p0, p1, p2, p3);
            this.railParts.push(railPart);
        }
    }
}

export function getBezierRailForActor(sceneObjHolder: SceneObjHolder, actorIter: JMapInfoIter): BezierRail {
    const railId = actorIter.getValueNumber('CommonPath_ID', -1);
    const stageDataHolder = sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(actorIter)!;
    const [railIter, pointInfo] = stageDataHolder.getCommonPathPointInfo(railId);
    return new BezierRail(sceneObjHolder, railIter, pointInfo);
}

export function isConnectedWithRail(actorIter: JMapInfoIter) {
    return actorIter.getValueNumber('CommonPath_ID', -1) !== -1;
}

export class RailRider {
    private bezierRail: BezierRail;
    private currentPos = vec3.create();

    constructor(sceneObjHolder: SceneObjHolder, private actor: LiveActor, actorIter: JMapInfoIter) {
        assert(isConnectedWithRail(actorIter));
        this.bezierRail = getBezierRailForActor(sceneObjHolder, actorIter);
    }
}
