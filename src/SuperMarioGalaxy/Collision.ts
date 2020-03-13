
import { vec3, mat4 } from "gl-matrix";
import { SceneObjHolder, ResourceHolder, SceneObj } from "./Main";
import { NameObj } from "./NameObj";
import { KCollisionServer, CheckArrowResult } from "./KCollisionServer";
import { HitSensor } from "./HitSensor";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ZoneAndLayer, LiveActor, makeMtxTRSFromActor } from "./LiveActor";
import { assertExists, nArray, assert, arrayRemoveIfExist } from "../util";
import { transformVec3Mat4w1, transformVec3Mat4w0, isNearZero, isNearZeroVec3 } from "../MathHelpers";
import { preScaleMtx, connectToScene } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { JMapInfoIter } from "./JMapInfo";

export class Triangle {
    public collisionParts: CollisionParts | null = null;
    public prismIdx: number | null = null;
    public hitSensor: HitSensor | null = null;
    public pos0: vec3 = vec3.create();
    public pos1: vec3 = vec3.create();
    public pos2: vec3 = vec3.create();

    public getAttributes(): JMapInfoIter | null {
        if (this.prismIdx !== null)
            return this.collisionParts!.collisionServer.getAttributes(this.prismIdx);
        else
            return null;
    }

    public copy(other: Triangle): void {
        this.collisionParts = other.collisionParts;
        this.prismIdx = other.prismIdx;
        this.hitSensor = other.hitSensor;
        vec3.copy(this.pos0, other.pos0);
        vec3.copy(this.pos1, other.pos1);
        vec3.copy(this.pos2, other.pos2);
    }

    public fillData(collisionParts: CollisionParts, prismIdx: number, hitSensor: HitSensor): void {
        this.collisionParts = collisionParts;
        this.prismIdx = prismIdx;
        this.hitSensor = hitSensor;

        const server = collisionParts.collisionServer;
        const prismData = server.getPrismData(prismIdx);

        server.getPos(this.pos0, prismData, 0);
        transformVec3Mat4w1(this.pos0, collisionParts.worldMtx, this.pos0);
        server.getPos(this.pos1, prismData, 1);
        transformVec3Mat4w1(this.pos1, collisionParts.worldMtx, this.pos1);
        server.getPos(this.pos2, prismData, 2);
        transformVec3Mat4w1(this.pos2, collisionParts.worldMtx, this.pos2);
    }
}

export class HitInfo extends Triangle {
    public strikeLoc = vec3.create();
    public distance: number = -1;
}

export const enum Category {
    Map = 0,
}

export class TriangleFilterBase {
    public isInvalidTriangle(triangle: Triangle): boolean {
        return false;
    }
}

export class CollisionPartsFilterBase {
    public isInvalidParts(triangle: CollisionParts): boolean {
        return false;
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class CollisionParts {
    public validated: boolean = false;
    public hostMtx: mat4 | null = null;

    public collisionServer: KCollisionServer;
    public invWorldMtx = mat4.create();
    public worldMtx = mat4.create();

    private collisionZone: CollisionZone;
    private checkArrowResult = new CheckArrowResult();

    constructor(sceneObjHolder: SceneObjHolder, zoneAndLayer: ZoneAndLayer, initialHostMtx: mat4, public hitSensor: HitSensor, kclData: ArrayBufferSlice, paData: ArrayBufferSlice | null, public keeperIdx: number, private scaleType: CollisionScaleType) {
        this.collisionServer = new KCollisionServer(kclData, paData);

        sceneObjHolder.create(SceneObj.CollisionDirector);
        const director = assertExists(sceneObjHolder.collisionDirector);
        this.collisionZone = director.keepers[keeperIdx].getZone(zoneAndLayer.zoneId);

        this.resetAllMtx(initialHostMtx);
        // calcFarthestVertexDistance
        // updateBoundingSphereRange
    }

    public updateMtx(): void {
        // TODO(jstpierre)
    }

    public addToBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.keeperIdx].addToZone(this, this.collisionZone.zoneId);
    }

    public removeFromBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.keeperIdx].removeFromZone(this, this.collisionZone.zoneId);
    }

    private makeEqualScale(mtx: mat4): void {
        if (this.scaleType === CollisionScaleType.AutoScale) {
            // Nothing to do; leave alone.
            return;
        }

        mat4.getScaling(scratchVec3a, mtx);
        const scaleXY = scratchVec3a[0] - scratchVec3a[1];
        const scaleZX = scratchVec3a[2] - scratchVec3a[0];
        const scaleYZ = scratchVec3a[1] - scratchVec3a[2];

        if (isNearZero(scaleXY, 0.001) && isNearZero(scaleZX, 0.001) && isNearZero(scaleYZ, 0.001))
            return;

        let scale: number;
        if (this.scaleType === CollisionScaleType.NotUsingScale) {
            // Invert the scale.
            scale = 1.0;
        } else if (this.scaleType === CollisionScaleType.AutoEqualScale) {
            // Equalize the scale.
            scale = (scratchVec3a[0] + scratchVec3a[1] + scratchVec3a[2]) / 3.0;
        } else {
            throw "whoops";
        }

        vec3.set(scratchVec3a, scale / scratchVec3a[0], scale / scratchVec3a[1], scale / scratchVec3a[2]);
        preScaleMtx(mtx, scratchVec3a);
    }

    private resetAllMtxPrivate(hostMtx: mat4): void {
        mat4.copy(this.worldMtx, hostMtx);
        mat4.invert(this.invWorldMtx, hostMtx);
    }

    public resetAllMtx(hostMtx: mat4): void {
        this.resetAllMtxPrivate(hostMtx);
    }

    public resetAllMtxFromHost(): void {
        mat4.copy(scratchMatrix, assertExists(this.hostMtx));
        this.makeEqualScale(scratchMatrix);
        this.resetAllMtxPrivate(scratchMatrix);
    }

    public checkStrikeLine(hitInfo: HitInfo[], dstIdx: number, p0: vec3, pDir: vec3, triFilter: TriangleFilterBase | null): number {
        transformVec3Mat4w1(scratchVec3a, this.invWorldMtx, p0);
        transformVec3Mat4w0(scratchVec3b, this.invWorldMtx, pDir);
        this.checkArrowResult.reset();
        this.collisionServer.checkArrow(this.checkArrowResult, hitInfo.length, scratchVec3a, scratchVec3b);

        const dstIdxStart: number = dstIdx;
        for (let i = 0; i < hitInfo.length; i++) {
            const prism = this.checkArrowResult.prisms[i];
            if (prism === null)
                break;

            const prismIdx = this.collisionServer.toIndex(prism);
            hitInfo[dstIdx].fillData(this, prismIdx, this.hitSensor);
            if (triFilter !== null && triFilter.isInvalidTriangle(hitInfo[dstIdx]))
                continue;

            const dist = this.checkArrowResult.distances[i]!;
            vec3.scaleAndAdd(hitInfo[dstIdx].strikeLoc, scratchVec3a, scratchVec3b, dist);
            transformVec3Mat4w1(hitInfo[dstIdx].strikeLoc, this.worldMtx, hitInfo[dstIdx].strikeLoc);
            hitInfo[dstIdx].distance = dist;
            dstIdx++;
        }
        return dstIdx - dstIdxStart;
    }
}

class CollisionZone {
    public boundingSphereCenter: vec3 | null = null;
    public boundingSphereRadius: number | null = null;
    public parts: CollisionParts[] = [];

    constructor(public zoneId: number) {
        if (false && this.zoneId > 0) {
            this.boundingSphereCenter = vec3.create();
            this.boundingSphereRadius = -1;
        }
    }

    public addParts(parts: CollisionParts): void {
        this.parts.push(parts);
        if (this.boundingSphereCenter !== null)
            this.calcMinAndMaxRadius();
    }

    public eraseParts(parts: CollisionParts): void {
        arrayRemoveIfExist(this.parts, parts);
    }

    private calcMinAndMaxRadius(): void {
        // TODO(jstpierre)
    }
}

// const scratchAABB = new AABB();
class CollisionCategorizedKeeper {
    public strikeInfoCount: number = 0;
    public strikeInfo: HitInfo[] = nArray(32, () => new HitInfo());

    private zones: CollisionZone[] = [];

    constructor(public keeperIdx: number) {
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;

                if (this.keeperIdx === parts.keeperIdx)
                    parts.updateMtx();

                // TODO(jstpierre): calcMinMaxAndRadius
            }
        }
    }

    public addToZone(parts: CollisionParts, zoneId: number): void {
        this.getZone(zoneId).addParts(parts);
    }

    public removeFromZone(parts: CollisionParts, zoneId: number): void {
        const zone = this.zones[zoneId];
        if (zone === undefined)
            return;
        zone.eraseParts(parts);
    }

    public getStrikeInfo(idx: number): HitInfo {
        return this.strikeInfo[idx];
    }

    public checkStrikeLine(p0: vec3, dir: vec3, partsFilter: CollisionPartsFilterBase | null, triFilter: TriangleFilterBase | null, maxStrikeInfos: number = this.strikeInfo.length): number {
        let idx = 0;

        /*
        scratchAABB.setInf();
        scratchAABB.unionPoint(p0);
        vec3.add(scratchVec3a, p0, dir);
        scratchAABB.unionPoint(scratchVec3a);
        */

        outer:
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            if (zone.boundingSphereCenter !== null) {
                // TODO(jstpierre): Bounding sphere test for non-primary zones.
                // scratchAABB.containsSphere(zone.boundingSphereCenter, zone.boundingSphereRadius);
                // checkHitSegmentSphere
            }

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;
                if (partsFilter !== null && partsFilter.isInvalidParts(parts))
                    continue;

                // TODO(jstpierre): Bounding sphere tests.
                // scratchAABB.containsSphere(parts.trans, parts.radius);
                // checkHitSegmentSphere

                idx += parts.checkStrikeLine(this.strikeInfo, idx, p0, dir, triFilter);
                if (idx >= this.strikeInfo.length)
                    break outer;
            }
        }

        this.strikeInfoCount = idx;
        return idx;
    }

    public getZone(zoneId: number): CollisionZone {
        if (this.zones[zoneId] === undefined)
            this.zones[zoneId] = new CollisionZone(zoneId);

        return this.zones[zoneId];
    }
}

export class CollisionDirector extends NameObj {
    public keepers: CollisionCategorizedKeeper[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'CollisionDirector');

        for (let i = 0; i < 4; i++)
            this.keepers[i] = new CollisionCategorizedKeeper(i);

        connectToScene(sceneObjHolder, this, 0x20, -1, -1, -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        for (let i = 0; i < this.keepers.length; i++)
            this.keepers[i].movement(sceneObjHolder);
    }
}

function isFloorPolygonAngle(v: number): boolean {
    // 70 degrees -- Math.cos(70*Math.PI/180)
    return Math.abs(v) < 0.3420201433256688;
}

function isFloorPolygon(normal: vec3, gravityVector: vec3): boolean {
    return isNearZeroVec3(normal, 0.001) && isFloorPolygonAngle(vec3.dot(normal, gravityVector));
}

export class Binder {
    public triangleFilter: TriangleFilterBase | null = null;

    public bind(dst: vec3, velocity: vec3): void {
    }

    public clear(): void {
    }

    public setTriangleFilter(filter: TriangleFilterBase): void {
        this.triangleFilter = filter;
    }
}

export function getFirstPolyOnLineCategory(sceneObjHolder: SceneObjHolder, dst: vec3 | null, dstTriangle: Triangle | null, p0: vec3, dir: vec3, triFilter: TriangleFilterBase | null, partsFilter: CollisionPartsFilterBase | null, category: Category): boolean {
    const director = sceneObjHolder.collisionDirector;
    if (director === null)
        return false;

    const keeper = director.keepers[category];
    const count = keeper.checkStrikeLine(p0, dir, partsFilter, null);
    if (count === 0)
        return false;

    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < count; i++) {
        const strikeInfo = keeper.getStrikeInfo(i);
        if (triFilter !== null && triFilter.isInvalidTriangle(strikeInfo))
            continue;
        if (strikeInfo.distance < bestDist) {
            bestDist = strikeInfo.distance;
            bestIdx = i;
        }
    }

    assert(bestIdx >= 0);
    const bestStrike = keeper.getStrikeInfo(bestIdx);

    if (dst !== null)
        vec3.copy(dst, bestStrike.strikeLoc);
    if (dstTriangle !== null)
        dstTriangle.copy(bestStrike);

    return true;
}

export function getFirstPolyOnLineToMap(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: vec3, dir: vec3): boolean {
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, null, Category.Map);
}

const scratchVec3c = vec3.create();
export function calcMapGround(sceneObjHolder: SceneObjHolder, dst: vec3, p0: vec3, height: number): boolean {
    vec3.set(scratchVec3c, 0.0, -height, 0.0);
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, null, p0, scratchVec3c, null, null, Category.Map);
}

export const enum CollisionScaleType {
    AutoEqualScale,
    NotUsingScale,
    AutoScale,
}

function createCollisionParts(sceneObjHolder: SceneObjHolder, zoneAndLayer: ZoneAndLayer, resourceHolder: ResourceHolder, name: string, hitSensor: HitSensor, initialHostMtx: mat4, scaleType: CollisionScaleType, category: Category): CollisionParts {
    const kclData = assertExists(resourceHolder.arc.findFileData(`${name}.kcl`));
    const paData = resourceHolder.arc.findFileData(`${name}.pa`);
    return new CollisionParts(sceneObjHolder, zoneAndLayer, initialHostMtx, hitSensor, kclData, paData, category, scaleType);
}

export function validateCollisionParts(sceneObjHolder: SceneObjHolder, parts: CollisionParts): void {
    parts.addToBelongZone(sceneObjHolder);
    parts.validated = true;
}

export function invalidateCollisionParts(sceneObjHolder: SceneObjHolder, parts: CollisionParts): void {
    parts.removeFromBelongZone(sceneObjHolder);
    parts.validated = false;
}

const scratchMatrix = mat4.create();
export function createCollisionPartsFromLiveActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensor: HitSensor, hostMtx: mat4 | null, scaleType: CollisionScaleType): CollisionParts {
    let initialHostMtx: mat4;
    if (hostMtx !== null) {
        initialHostMtx = hostMtx;
    } else {
        makeMtxTRSFromActor(scratchMatrix, actor);
        initialHostMtx = scratchMatrix;
    }

    const parts = createCollisionParts(sceneObjHolder, actor.zoneAndLayer, actor.resourceHolder, name, hitSensor, scratchMatrix, scaleType, Category.Map);

    if (hostMtx !== null)
        parts.hostMtx = hostMtx;

    return parts;
}
