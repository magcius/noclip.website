
import { vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { SceneObjHolder, ResourceHolder, SceneObj } from "./Main";
import { NameObj } from "./NameObj";
import { KCollisionServer, CheckCollideResult, KC_PrismData } from "./KCollisionServer";
import { HitSensor } from "./HitSensor";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ZoneAndLayer, LiveActor, makeMtxTRSFromActor } from "./LiveActor";
import { assertExists, nArray, assert, arrayRemoveIfExist } from "../util";
import { transformVec3Mat4w1, transformVec3Mat4w0, isNearZero, isNearZeroVec3, getMatrixTranslation, Vec3Zero } from "../MathHelpers";
import { connectToScene, vecKillElement } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { JMapInfoIter } from "./JMapInfo";
import { AABB } from "../Geometry";

export class Triangle {
    public collisionParts: CollisionParts | null = null;
    public prismIdx: number | null = null;
    public hitSensor: HitSensor | null = null;
    public pos0 = vec3.create();
    public pos1 = vec3.create();
    public pos2 = vec3.create();
    public faceNormal = vec3.create();

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
        vec3.copy(this.faceNormal, other.faceNormal);
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
        server.getFaceNormal(this.faceNormal, prismData);
        transformVec3Mat4w0(this.faceNormal, collisionParts.worldMtx, this.faceNormal);
    }
}

export class HitInfo extends Triangle {
    public strikeLoc = vec3.create();
    public distance: number = -1;

    public copy(other: HitInfo): void {
        super.copy(other);
        vec3.copy(this.strikeLoc, other.strikeLoc);
        this.distance = other.distance;
    }
}

export const enum Category {
    Map = 0,
    Sunshade = 1,
    WaterSurface = 2,
    MoveLimit = 3,
}

export type TriangleFilterFunc = (sceneObjHolder: SceneObjHolder, triangle: Triangle) => boolean;
export type CollisionPartsFilterFunc = (sceneObjHolder: SceneObjHolder, parts: CollisionParts) => boolean;

function getAvgScale(v: vec3): number {
    return (v[0] + v[1] + v[2]) / 3.0;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class CollisionParts {
    public validated: boolean = false;
    public hostMtx: mat4 | null = null;

    public collisionServer: KCollisionServer;
    public newWorldMtx = mat4.create();
    public invWorldMtx = mat4.create();
    public worldMtx = mat4.create();
    public oldWorldMtx = mat4.create();
    public notMovedCounter = 0;

    private collisionZone: CollisionZone;
    private checkCollisionResult = new CheckCollideResult();

    private scale = 0.0;
    public boundingSphereRadius: number = 0.0;

    private setUpdateMtx = true;
    private setUpdateMtxOneTime = false;

    constructor(sceneObjHolder: SceneObjHolder, zoneAndLayer: ZoneAndLayer, initialHostMtx: mat4, public hitSensor: HitSensor, kclData: ArrayBufferSlice, paData: ArrayBufferSlice | null, public keeperIdx: number, private scaleType: CollisionScaleType) {
        this.collisionServer = new KCollisionServer(kclData, paData);

        sceneObjHolder.create(SceneObj.CollisionDirector);
        const director = assertExists(sceneObjHolder.collisionDirector);
        this.collisionZone = director.keepers[keeperIdx].getZone(zoneAndLayer.zoneId);

        this.resetAllMtx(initialHostMtx);
        this.collisionServer.calcFarthestVertexDistance();

        mat4.getScaling(scratchVec3a, initialHostMtx);
        this.updateBoundingSphereRangeFromScaleVector(scratchVec3a);
    }

    public getTrans(dst: vec3): void {
        getMatrixTranslation(dst, this.worldMtx);
    }

    public setMtxFromHost(): void {
        mat4.copy(this.newWorldMtx, this.hostMtx!);
    }

    public setMtx(m: mat4): void {
        mat4.copy(this.newWorldMtx, m);
    }

    public updateMtx(): void {
        const notMoved = !mat4.equals(this.newWorldMtx, this.worldMtx);

        if (this.setUpdateMtx || this.setUpdateMtxOneTime) {
            if (notMoved) {
                this.notMovedCounter++;
            } else {
                // Matrices are different, update the notMovedCounter.
                this.notMovedCounter = 0;
                if (this.setUpdateMtxOneTime)
                    this.notMovedCounter = 1;

                const scale = this.makeEqualScale(this.newWorldMtx);
                if (isNearZero(scale - this.scale, 0.001))
                    this.updateBoundingSphereRangePrivate(scale);
            }

            this.setUpdateMtxOneTime = false;

            if (this.notMovedCounter < 2) {
                mat4.copy(this.oldWorldMtx, this.worldMtx);
                mat4.copy(this.worldMtx, this.newWorldMtx);
                mat4.invert(this.invWorldMtx, this.worldMtx);
            }
        } else {
            if (notMoved)
                this.notMovedCounter++;
        }
    }

    public forceResetAllMtxAndSetUpdateMtxOneTime(): void {
        mat4.copy(scratchMatrix, this.hostMtx!);
        this.makeEqualScale(scratchMatrix);
        this.resetAllMtxPrivate(scratchMatrix);
        this.setUpdateMtxOneTime = true;
    }

    public addToBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.keeperIdx].addToZone(this, this.collisionZone.zoneId);
    }

    public removeFromBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.keeperIdx].removeFromZone(this, this.collisionZone.zoneId);
    }

    private makeEqualScale(mtx: mat4): number {
        if (this.scaleType === CollisionScaleType.AutoScale) {
            // Nothing to do; leave alone.
            return 1.0;
        }

        mat4.getScaling(scratchVec3a, mtx);
        const scaleXY = scratchVec3a[0] - scratchVec3a[1];
        const scaleZX = scratchVec3a[2] - scratchVec3a[0];
        const scaleYZ = scratchVec3a[1] - scratchVec3a[2];

        if (isNearZero(scaleXY, 0.001) && isNearZero(scaleZX, 0.001) && isNearZero(scaleYZ, 0.001))
            return scratchVec3a[0];

        let scale: number;
        if (this.scaleType === CollisionScaleType.NotUsingScale) {
            // Invert the scale.
            scale = 1.0;
        } else if (this.scaleType === CollisionScaleType.AutoEqualScale) {
            // Equalize the scale.
            scale = getAvgScale(scratchVec3a);
        } else {
            throw "whoops";
        }

        vec3.set(scratchVec3a, scale / scratchVec3a[0], scale / scratchVec3a[1], scale / scratchVec3a[2]);
        mat4.scale(mtx, mtx, scratchVec3a);
        return scale;
    }

    private updateBoundingSphereRangePrivate(scale: number): void {
        this.scale = scale;
        this.boundingSphereRadius = this.collisionServer.farthestVertexDistance;
    }

    public updateBoundingSphereRangeFromScaleVector(scaleVec: vec3): void {
        this.updateBoundingSphereRangePrivate(getAvgScale(scaleVec));
    }

    public updateBoundingSphereRangeFromHostMtx(): void {
        this.updateBoundingSphereRangePrivate(this.makeEqualScale(this.hostMtx!));
    }

    private resetAllMtxPrivate(hostMtx: mat4): void {
        mat4.copy(this.newWorldMtx, hostMtx);
        mat4.copy(this.oldWorldMtx, hostMtx);
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

    public checkStrikeLine(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, p0: vec3, pDir: vec3, triFilter: TriangleFilterFunc | null): number {
        transformVec3Mat4w1(scratchVec3a, this.invWorldMtx, p0);
        transformVec3Mat4w0(scratchVec3b, this.invWorldMtx, pDir);
        this.checkCollisionResult.reset();
        this.collisionServer.checkArrow(this.checkCollisionResult, hitInfo.length, scratchVec3a, scratchVec3b);

        const dstIdxStart = dstIdx;
        for (let i = 0; i < hitInfo.length; i++) {
            const prism = this.checkCollisionResult.prisms[i];
            if (prism === null)
                break;

            const prismIdx = this.collisionServer.toIndex(prism);
            hitInfo[dstIdx].fillData(this, prismIdx, this.hitSensor);
            if (triFilter !== null && triFilter(sceneObjHolder, hitInfo[dstIdx]))
                continue;

            const dist = this.checkCollisionResult.distances[i]!;
            vec3.scaleAndAdd(hitInfo[dstIdx].strikeLoc, scratchVec3a, scratchVec3b, dist);
            transformVec3Mat4w1(hitInfo[dstIdx].strikeLoc, this.worldMtx, hitInfo[dstIdx].strikeLoc);
            hitInfo[dstIdx].distance = dist;
            dstIdx++;
        }
        return dstIdx - dstIdxStart;
    }

    private projectToPlane(dst: vec3, pos: vec3, planePos: vec3, normal: vec3): void {
        // Put in plane space.
        vec3.sub(dst, pos, planePos);
        vec3.scaleAndAdd(dst, pos, normal, vec3.dot(dst, normal));
    }

    private calcCollidePosition(dst: vec3, prism: KC_PrismData, classification: number): void {
        assert(classification > 0);

        if (classification === 1) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === 2) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal1(scratchVec3a, prism);
            // this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === 3) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal2(scratchVec3a, prism);
            // this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === 4) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal2(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 1);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === 5) {
            this.collisionServer.getPos(dst, prism, 0);
        } else if (classification === 6) {
            this.collisionServer.getPos(dst, prism, 1);
        } else if (classification === 7) {
            this.collisionServer.getPos(dst, prism, 2);
        } else {
            throw "whoops";
        }
    }

    private checkStrikeBallCore(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, pos: ReadonlyVec3, p1: ReadonlyVec3, radius: number, invAvgScale: number, avgScale: number, triFilter: TriangleFilterFunc | null, normalFilter: vec3 | null): number {
        // Copy the positions before we run checkSphere, as pos is scratchVec3a, and we're going to stomp on it below.
        for (let i = dstIdx; i < hitInfo.length; i++)
            vec3.copy(hitInfo[i].strikeLoc, pos);
        this.checkCollisionResult.reset();
        this.collisionServer.checkSphere(this.checkCollisionResult, hitInfo.length, pos, radius, invAvgScale);

        const dstIdxStart = dstIdx;
        for (let i = 0; i < hitInfo.length; i++) {
            const prism = this.checkCollisionResult.prisms[i];
            if (prism === null)
                break;

            this.calcCollidePosition(hitInfo[dstIdx].strikeLoc, prism, this.checkCollisionResult.classifications[i]);
            transformVec3Mat4w1(hitInfo[dstIdx].strikeLoc, this.worldMtx, hitInfo[dstIdx].strikeLoc);

            const prismIdx = this.collisionServer.toIndex(prism);
            hitInfo[dstIdx].fillData(this, prismIdx, this.hitSensor);
            if (triFilter !== null && triFilter(sceneObjHolder, hitInfo[dstIdx]))
                continue;
            if (normalFilter !== null && vec3.dot(normalFilter, hitInfo[dstIdx].faceNormal) > 0.0)
                continue;

            const dist = this.checkCollisionResult.distances[i]!;
            hitInfo[dstIdx].distance = dist;
            dstIdx++;
        }
        return dstIdx - dstIdxStart;
    }

    public checkStrikeBall(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, pos: ReadonlyVec3, radius: number, movingReaction: boolean, triFilter: TriangleFilterFunc | null): number {
        transformVec3Mat4w1(scratchVec3a, this.invWorldMtx, pos);
        mat4.getScaling(scratchVec3b, this.invWorldMtx);
        const invAvgScale = getAvgScale(scratchVec3b);
        const avgScale = 1.0 / invAvgScale;
        const scaledRadius = invAvgScale * radius;

        if (!movingReaction || this.notMovedCounter === 0) {
            return this.checkStrikeBallCore(sceneObjHolder, hitInfo, dstIdx, scratchVec3a, Vec3Zero, scaledRadius, invAvgScale, avgScale, triFilter, null);
        } else {
            throw "whoops";
        }
    }

    public calcForceMovePower(dst: vec3, pos: ReadonlyVec3): void {
        mat4.invert(scratchMatrix, this.oldWorldMtx);
        transformVec3Mat4w1(dst, scratchMatrix, pos);
        transformVec3Mat4w1(dst, this.worldMtx, pos);
        vec3.sub(dst, dst, pos);
    }
}

function isInRange(v: number, v0: number, v1: number): boolean {
    const min = Math.min(v0, v1), max = Math.max(v0, v1);
    return v >= min && v <= max;
}

class CollisionZone {
    public boundingSphereCenter: vec3 | null = null;
    public boundingSphereRadius: number | null = null;
    public boundingAABB: AABB | null = null;
    public parts: CollisionParts[] = [];

    constructor(public zoneId: number) {
        if (this.zoneId > 0) {
            this.boundingSphereCenter = vec3.create();
            this.boundingSphereRadius = -1;
            this.boundingAABB = new AABB();
        }
    }

    public addParts(parts: CollisionParts): void {
        this.parts.push(parts);

        if (this.calcMinMaxAddParts(parts))
            this.calcCenterAndRadius();
    }

    public eraseParts(parts: CollisionParts): void {
        arrayRemoveIfExist(this.parts, parts);
    }

    public calcMinMaxAndRadiusIfMoveOuter(parts: CollisionParts): void {
        if (this.boundingSphereCenter === null || this.boundingSphereRadius === null || this.boundingAABB === null)
            return;

        parts.getTrans(scratchVec3a);
        const r = parts.boundingSphereRadius;
        if (!isInRange(scratchVec3a[0], this.boundingAABB.minX + r, this.boundingAABB.maxX - r) ||
            !isInRange(scratchVec3a[1], this.boundingAABB.minY + r, this.boundingAABB.maxY - r) ||
            !isInRange(scratchVec3a[2], this.boundingAABB.minZ + r, this.boundingAABB.maxZ - r))
            this.calcMinMaxAndRadius();
    }

    private calcCenterAndRadius(): void {
        this.boundingAABB!.centerPoint(this.boundingSphereCenter!);
        this.boundingSphereRadius = Math.sqrt(this.boundingAABB!.diagonalLengthSquared());
    }

    private calcMinMaxAddParts(parts: CollisionParts): boolean {
        if (this.boundingAABB === null)
            return false;

        let changed = false;

        vec3.set(scratchVec3b, parts.boundingSphereRadius, parts.boundingSphereRadius, parts.boundingSphereRadius);

        parts.getTrans(scratchVec3a);
        vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        if (this.boundingAABB.unionPoint(scratchVec3a))
            changed = true;

        parts.getTrans(scratchVec3a);
        vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        if (this.boundingAABB.unionPoint(scratchVec3a))
            changed = true;

        return changed;
    }

    public calcMinMaxAndRadius(): void {
        if (this.boundingSphereCenter === null || this.boundingSphereRadius === null || this.boundingAABB === null)
            return;

        this.boundingAABB.reset();
        for (let i = 0; i < this.parts.length; i++)
            this.calcMinMaxAddParts(this.parts[i]);
        this.calcCenterAndRadius();
    }
}

function checkHitSegmentSphere(dstDirection: vec3 | null, p0: vec3, dir: vec3, sphereCenter: vec3, sphereRadius: number): boolean {
    // Put in space of P0
    vec3.sub(scratchVec3c, sphereCenter, p0);

    const dot = vec3.dot(scratchVec3c, dir);
    const sqSphereRadius = sphereRadius*sphereRadius;
    if (dot >= 0.0) {
        const sqSegLength = vec3.squaredLength(dir);
        if (sqSegLength >= dot) {
            // Arrow goes through sphere. Find the intersection point.
            vec3.scale(scratchVec3b, dir, dot / sqSegLength);
            if (vec3.squaredDistance(scratchVec3b, scratchVec3c) <= sqSphereRadius) {
                if (dstDirection !== null) {
                    vec3.negate(dstDirection, scratchVec3b);
                    vec3.normalize(dstDirection, dstDirection);
                }

                return true;
            }
        } else {
            // Arrow does not go through sphere; might or might not go inside. Check P1
            const sqDist = vec3.squaredDistance(dir, scratchVec3c);
            if (sqDist < sqSphereRadius) {
                if (dstDirection !== null) {
                    vec3.sub(dstDirection, scratchVec3c, dir);
                    vec3.normalize(dstDirection, dstDirection);
                }

                return true;
            }
        }
    } else {
        // Arrow is pointed away from the sphere. The only way that this could hit is if P0 is inside the sphere.
        const sqDist = vec3.squaredLength(scratchVec3c);
        if (sqDist < sqSphereRadius) {
            if (dstDirection !== null) {
                vec3.sub(dstDirection, sphereCenter, p0);
                vec3.normalize(dstDirection, dstDirection);
            }

            return true;
        }
    }

    return false;
}

const scratchAABB = new AABB();
class CollisionCategorizedKeeper {
    public strikeInfoCount: number = 0;
    public strikeInfo: HitInfo[] = nArray(32, () => new HitInfo());

    private zones: CollisionZone[] = [];
    private forceCalcMinMaxAndRadius = false;

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

                if (!this.forceCalcMinMaxAndRadius && parts.notMovedCounter === 0)
                    zone.calcMinMaxAndRadiusIfMoveOuter(parts);
            }

            if (this.forceCalcMinMaxAndRadius)
                zone.calcMinMaxAndRadius();
        }

        this.forceCalcMinMaxAndRadius = false;
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

    public addToGlobal(parts: CollisionParts): void {
        this.addToZone(parts, 0);
    }

    public removeFromGlobal(parts: CollisionParts): void {
        this.removeFromZone(parts, 0);
    }

    public checkStrikeLine(sceneObjHolder: SceneObjHolder, p0: vec3, dir: vec3, partsFilter: CollisionPartsFilterFunc | null, triFilter: TriangleFilterFunc | null): number {
        let idx = 0;

        scratchAABB.reset();
        scratchAABB.unionPoint(p0);
        vec3.add(scratchVec3a, p0, dir);
        scratchAABB.unionPoint(scratchVec3a);

        outer:
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            if (zone.boundingSphereCenter !== null) {
                if (!scratchAABB.containsSphere(zone.boundingSphereCenter, zone.boundingSphereRadius!))
                    continue;

                if (!checkHitSegmentSphere(null, p0, dir, zone.boundingSphereCenter, zone.boundingSphereRadius!))
                    continue;
            }

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;
                if (partsFilter !== null && partsFilter(sceneObjHolder, parts))
                    continue;

                parts.getTrans(scratchVec3a);
                if (!scratchAABB.containsSphere(scratchVec3a, parts.boundingSphereRadius))
                    continue;

                if (!checkHitSegmentSphere(null, p0, dir, scratchVec3a, parts.boundingSphereRadius))
                    continue;

                idx += parts.checkStrikeLine(sceneObjHolder, this.strikeInfo, idx, p0, dir, triFilter);
                if (idx >= this.strikeInfo.length)
                    break outer;
            }
        }

        this.strikeInfoCount = idx;
        return idx;
    }

    public checkStrikeBall(sceneObjHolder: SceneObjHolder, pos: vec3, radius: number, movingReaction: boolean, partsFilter: CollisionPartsFilterFunc | null, triFilter: TriangleFilterFunc | null): number {
        let idx = 0;

        outer:
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            if (zone.boundingAABB !== null) {
                // Sphere/AABB intersection.
                if (!zone.boundingAABB.containsSphere(pos, radius))
                    continue;

                // Sphere/Sphere intersection.
                if (vec3.squaredDistance(pos, zone.boundingSphereCenter!) > ((radius + zone.boundingSphereRadius!) ** 2))
                    continue;
            }

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;
                if (partsFilter !== null && partsFilter(sceneObjHolder, parts))
                    continue;

                // Crude Sphere/Box intersection.
                const combinedRadius = radius + parts.boundingSphereRadius;
                parts.getTrans(scratchVec3a);
                if (Math.abs(scratchVec3a[0] - pos[0]) > combinedRadius)
                    continue;
                if (Math.abs(scratchVec3a[1] - pos[1]) > combinedRadius)
                    continue;
                if (Math.abs(scratchVec3a[2] - pos[2]) > combinedRadius)
                    continue;

                // Sphere/Sphere intersection.
                if (vec3.squaredDistance(scratchVec3a, pos) > combinedRadius ** 2)
                    continue;

                idx += parts.checkStrikeBall(sceneObjHolder, this.strikeInfo, idx, pos, radius, movingReaction, triFilter);
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

enum WallCode {
    Normal           = 0,
    NotWallJump      = 1,
    NotWallSlip      = 2,
    NotGrab          = 3,
    GhostThroughCode = 4,
    NotSideStep      = 5,
    Rebound          = 6,
    Fur              = 7,
    NoAction         = 8,
};

class CollisionCode {
    public getWallCodeString(string: string): WallCode {
        return assertExists((WallCode as any)[string]);
    }

    public getWallCode(attr: JMapInfoIter): WallCode {
        return assertExists(attr.getValueNumber('Wall_code'));
    }
}

export class CollisionDirector extends NameObj {
    public keepers: CollisionCategorizedKeeper[] = [];
    public collisionCode = new CollisionCode();

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

export function getFirstPolyOnLineCategory(sceneObjHolder: SceneObjHolder, dst: vec3 | null, dstTriangle: Triangle | null, p0: vec3, dir: vec3, triFilter: TriangleFilterFunc | null, partsFilter: CollisionPartsFilterFunc | null, category: Category): boolean {
    const director = sceneObjHolder.collisionDirector;
    if (director === null)
        return false;

    const keeper = director.keepers[category];
    const count = keeper.checkStrikeLine(sceneObjHolder, p0, dir, partsFilter, null);
    if (count === 0)
        return false;

    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < count; i++) {
        const strikeInfo = keeper.strikeInfo[i];
        if (triFilter !== null && triFilter(sceneObjHolder, strikeInfo))
            continue;
        if (strikeInfo.distance < bestDist) {
            bestDist = strikeInfo.distance;
            bestIdx = i;
        }
    }

    assert(bestIdx >= 0);
    const bestStrike = keeper.strikeInfo[bestIdx];

    if (dst !== null)
        vec3.copy(dst, bestStrike.strikeLoc);
    if (dstTriangle !== null)
        dstTriangle.copy(bestStrike);

    return true;
}

export function getFirstPolyOnLineToMap(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: vec3, dir: vec3): boolean {
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, null, Category.Map);
}

export function createCollisionPartsFilterActor(actor: LiveActor): CollisionPartsFilterFunc {
    return (sceneObjHolder: SceneObjHolder, parts: CollisionParts): boolean => {
        return parts.hitSensor.actor === actor;
    };
}

export function getFirstPolyOnLineToMapExceptActor(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: vec3, dir: vec3, actor: LiveActor): boolean {
    const partsFilter = createCollisionPartsFilterActor(actor);
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, partsFilter, Category.Map);
}

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

    const parts = createCollisionParts(sceneObjHolder, actor.zoneAndLayer, actor.resourceHolder, name, hitSensor, initialHostMtx, scaleType, Category.Map);

    if (hostMtx !== null)
        parts.hostMtx = hostMtx;

    return parts;
}

function tryCreateCollisionParts(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor, category: Category, filenameBase: string): CollisionParts | null {
    const res = actor.resourceHolder.arc.findFileData(`${filenameBase}.kcl`);
    if (res === null)
        return null;

    makeMtxTRSFromActor(scratchMatrix, actor);
    const parts = createCollisionParts(sceneObjHolder, actor.zoneAndLayer, actor.resourceHolder, filenameBase, hitSensor, scratchMatrix, CollisionScaleType.AutoScale, category);
    if (parts !== null)
        validateCollisionParts(sceneObjHolder, parts);

    return parts;
}

export function tryCreateCollisionMoveLimit(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor): CollisionParts | null {
    return tryCreateCollisionParts(sceneObjHolder, actor, hitSensor, Category.MoveLimit, 'MoveLimit');
}

export function tryCreateCollisionWaterSurface(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor): CollisionParts | null {
    return tryCreateCollisionParts(sceneObjHolder, actor, hitSensor, Category.WaterSurface, 'WaterSurface');
}

//#region Binder
function isFloorPolygonAngle(v: number): boolean {
    // 70 degrees -- Math.cos(70*Math.PI/180)
    return v < -0.3420201433256688;
}

function isWallPolygonAngle(v: number): boolean {
    // 70 degrees -- Math.cos(70*Math.PI/180)
    return Math.abs(v) < 0.3420201433256688;
}

function isFloorPolygon(normal: vec3, gravityVector: vec3): boolean {
    return !isNearZeroVec3(normal, 0.001) && isFloorPolygonAngle(vec3.dot(normal, gravityVector));
}

function isWallPolygon(normal: vec3, gravityVector: vec3): boolean {
    return !isNearZeroVec3(normal, 0.001) && isWallPolygonAngle(vec3.dot(normal, gravityVector));
}

const enum BinderFindBindedPositionRet {
    NoCollide, Collide, MoveAlongHittedPlanes,
}

function isHostMoved(hitInfo: HitInfo): boolean {
    return hitInfo.collisionParts!.notMovedCounter === 0;
}

const scratchHitInfo = nArray(32, () => new HitInfo());
export class Binder {
    public partsFilter: CollisionPartsFilterFunc | null = null;
    public triangleFilter: TriangleFilterFunc | null = null;

    private exCollisionParts: CollisionParts | null = null;
    private exCollisionPartsValid: boolean = false;
    private hitInfos: HitInfo[];
    private hitInfoCount: number;

    private useHostBaseMtx: boolean = false;

    public expandDistance: boolean = false;
    public useMovingReaction: boolean = false;
    public moveWithCollision: boolean = false;

    public hostOffsetVec: vec3 | null = null;
    public fixReactionVec = vec3.create();

    public floorHitInfo = new HitInfo();
    public wallHitInfo = new HitInfo();
    public ceilingHitInfo = new HitInfo();

    constructor(private hostBaseMtx: mat4 | null, private hostTranslation: vec3, private hostGravity: vec3, private hostCenterY: number, private radius: number, hitInfoCapacity: number) {
        if (hitInfoCapacity === 0) {
            // Use global scratch space.
            this.hitInfos = scratchHitInfo;
        } else {
            this.hitInfos = nArray(hitInfoCapacity, () => new HitInfo());
        }

        this.clear();
    }

    public bind(sceneObjHolder: SceneObjHolder, dst: vec3, vel: ReadonlyVec3): void {
        this.clear();

        if (this.exCollisionPartsValid)
            sceneObjHolder.collisionDirector!.keepers[Category.Map].addToGlobal(assertExists(this.exCollisionParts));

        if (this.hostOffsetVec)
            vec3.copy(scratchVec3c, this.hostOffsetVec);
        else
            vec3.set(scratchVec3c, 0.0, this.hostCenterY, 0.0);

        if (this.useHostBaseMtx)
            transformVec3Mat4w0(scratchVec3c, this.hostBaseMtx!, scratchVec3c);

        vec3.add(scratchVec3c, this.hostTranslation, scratchVec3c);

        const origPosX = scratchVec3c[0];
        const origPosY = scratchVec3c[1];
        const origPosZ = scratchVec3c[2];

        let ret = this.findBindedPos(sceneObjHolder, scratchVec3c, vel, this.expandDistance, false);
        if (ret === BinderFindBindedPositionRet.NoCollide) {
            vec3.copy(dst, vel);
        } else {
            this.obtainMomentFixReaction(this.fixReactionVec);
            vec3.add(scratchVec3c, scratchVec3c, this.fixReactionVec);

            while (!this.expandDistance && ret === BinderFindBindedPositionRet.MoveAlongHittedPlanes) {
                // TODO(jstpierre): moveAlongHittedPlanes
                break;
            }

            this.storeContactPlane();

            if (this.moveWithCollision)
                this.moveWithCollisionParts(scratchVec3c, dst);

            dst[0] = scratchVec3c[0] - origPosX;
            dst[1] = scratchVec3c[1] - origPosY;
            dst[2] = scratchVec3c[2] - origPosZ;
        }

        if (this.exCollisionPartsValid)
            sceneObjHolder.collisionDirector!.keepers[Category.Map].removeFromGlobal(assertExists(this.exCollisionParts));
    }

    private findBindedPos(sceneObjHolder: SceneObjHolder, pos: vec3, vel: ReadonlyVec3, skipInitialPosition: boolean, expandDistance: boolean): BinderFindBindedPositionRet {
        const keeper = sceneObjHolder.collisionDirector!.keepers[Category.Map];

        const speed = vec3.length(vel);
        const numSteps = ((speed / 35.0) | 0) + 1;

        for (let i = 0; i <= numSteps; i++) {
            if (i === 0) {
                // TODO(jstpierre): 0x10 flag
                if (skipInitialPosition)
                    continue;
            }

            const hitCount = keeper.checkStrikeBall(sceneObjHolder, pos, this.radius, this.useMovingReaction, this.partsFilter, this.triangleFilter);
            if (hitCount !== 0) {
                // Hit something. We can stop searching.
                this.storeCurrentHitInfo(keeper, expandDistance);

                if (i < numSteps)
                    return BinderFindBindedPositionRet.MoveAlongHittedPlanes;
                else
                    return BinderFindBindedPositionRet.Collide;
            }

            vec3.scaleAndAdd(pos, pos, vel, 1.0 / numSteps);
        }

        // Never hit anything.
        return BinderFindBindedPositionRet.NoCollide;
    }

    private storeCurrentHitInfo(keeper: CollisionCategorizedKeeper, expandDistance: boolean): void {
        for (let i = 0; i < keeper.strikeInfoCount; i++) {
            if (this.hitInfoCount + i >= this.hitInfos.length) {
                this.hitInfoCount = this.hitInfos.length;
                return;
            }

            const dstHitInfo = this.hitInfos[this.hitInfoCount + i];
            dstHitInfo.copy(keeper.strikeInfo[i]);

            if (expandDistance)
                dstHitInfo.distance += 1.2;
        }

        this.hitInfoCount += keeper.strikeInfoCount;
    }

    private obtainMomentFixReaction(dst: vec3, start: number = 0): void {
        let minX = 0, minY = 0, minZ = 0;
        let maxX = 0, maxY = 0, maxZ = 0;

        for (let i = start; i < this.hitInfoCount; i++) {
            const hitInfo = this.hitInfos[i];

            const x = hitInfo.faceNormal[0] * hitInfo.distance;
            const y = hitInfo.faceNormal[1] * hitInfo.distance;
            const z = hitInfo.faceNormal[2] * hitInfo.distance;

            minX = Math.max(x, minX);
            minY = Math.max(y, minY);
            minZ = Math.max(z, minZ);

            maxX = Math.min(x, maxX);
            maxY = Math.min(y, maxY);
            maxZ = Math.min(z, maxZ);

            if (this.useMovingReaction) {
                // add on "asdf2" field.
                throw "whoops";
            }
        }

        dst[0] = minX + maxX;
        dst[1] = minY + maxY;
        dst[2] = minZ + maxZ;
    }

    private moveAlongHittedPlanes(sceneObjHolder: SceneObjHolder, dstVel: vec3, pos: vec3, moveVel: vec3, origVel: vec3, fixReactionVector: vec3): BinderFindBindedPositionRet {
        vec3.normalize(scratchVec3a, fixReactionVector);
        if (vec3.dot(moveVel, scratchVec3a) > 0.0)
            vecKillElement(moveVel, moveVel, scratchVec3a);

        if (vec3.dot(moveVel, origVel) >= 0.0) {
            const ret = this.findBindedPos(sceneObjHolder, pos, moveVel, true, false);
            vec3.add(dstVel, dstVel, moveVel);
            return ret;
        } else {
            return BinderFindBindedPositionRet.Collide;
        }
    }

    private moveWithCollisionParts(dstPos: vec3, dstVel: vec3): void {
        if (this.floorHitInfo.distance <= 0.0)
            return;
        if (!isHostMoved(this.floorHitInfo))
            return;

        this.floorHitInfo.collisionParts!.calcForceMovePower(scratchVec3a, dstPos);
        vec3.add(dstPos, dstPos, scratchVec3a);
        vec3.add(dstVel, dstVel, scratchVec3a);
    }

    private storeContactPlane(): void {
        for (let i = 0; i < this.hitInfoCount; i++) {
            const hitInfo = this.hitInfos[i];

            if (isFloorPolygon(hitInfo.faceNormal, this.hostGravity)) {
                if (hitInfo.distance > this.floorHitInfo.distance)
                    this.floorHitInfo.copy(hitInfo);
            } else if (isWallPolygon(hitInfo.faceNormal, this.hostGravity)) {
                if (hitInfo.distance > this.wallHitInfo.distance)
                    this.wallHitInfo.copy(hitInfo);
            } else {
                if (hitInfo.distance > this.ceilingHitInfo.distance)
                    this.ceilingHitInfo.copy(hitInfo);
            }
        }
    }

    public clear(): void {
        this.hitInfoCount = 0;
        this.floorHitInfo.distance = -99999.0;
        this.wallHitInfo.distance = -99999.0;
        this.ceilingHitInfo.distance = -99999.0;
    }

    public setTriangleFilter(filter: TriangleFilterFunc): void {
        this.triangleFilter = filter;
    }

    public setExCollisionParts(parts: CollisionParts | null): void {
        this.exCollisionParts = parts;
        this.exCollisionPartsValid = this.exCollisionParts !== null;
    }
}

export function isBindedGround(actor: LiveActor): boolean {
    return actor.binder!.floorHitInfo.distance >= 0.0;
}

export function isBindedRoof(actor: LiveActor): boolean {
    return actor.binder!.ceilingHitInfo.distance >= 0.0;
}

export function isBindedWall(actor: LiveActor): boolean {
    return actor.binder!.wallHitInfo.distance >= 0.0;
}

export function isBinded(actor: LiveActor): boolean {
    return isBindedGround(actor) || isBindedRoof(actor) || isBindedWall(actor);
}

export function isWallCodeNoAction(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    const attr = triangle.getAttributes()!;
    return sceneObjHolder.collisionDirector!.collisionCode.getWallCode(attr) === WallCode.NoAction;
}

export function setBindTriangleFilter(actor: LiveActor, triFilter: TriangleFilterFunc): void {
    actor.binder!.setTriangleFilter(triFilter);
}
//#endregion
