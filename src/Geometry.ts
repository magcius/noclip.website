
import { vec3, ReadonlyVec3, ReadonlyMat4, vec4, ReadonlyVec4, mat4 } from "gl-matrix";
import { GfxClipSpaceNearZ } from "./gfx/platform/GfxPlatform.js";
import { nArray } from "./util.js";
import type { ConvexHull } from "../rust/pkg/noclip_support";
import { rust } from "./rustlib.js";
import { getMatrixTranslation, vec3SetAll } from "./MathHelpers.js";

const scratchVec4 = vec4.create();
const scratchMatrix = mat4.create();
export class Plane {
    private static scratchVec3: vec3[] = nArray(2, () => vec3.create());
    public n = vec3.create();

    constructor(x: number = 0, y: number = 0, z: number = 0, public d: number = 0) {
        vec3.set(this.n, x, y, z);
    }

    public set(n: ReadonlyVec3, d: number): void {
        vec3.copy(this.n, n);
        this.d = d;
    }

    public copy(o: Plane): void {
        this.set(o.n, o.d);
    }

    public negate(): void {
        vec3.negate(this.n, this.n);
        this.d *= -1;
    }

    public distance(x: number, y: number, z: number): number {
        const nx = this.n[0], ny = this.n[1], nz = this.n[2];
        const dot = x*nx + y*ny + z*nz;
        return dot + this.d;
    }

    public distanceVec3(p: ReadonlyVec3): number {
        return vec3.dot(p, this.n) + this.d;
    }

    // Assumes input normal is not normalized.
    public set4Unnormalized(nx: number, ny: number, nz: number, d: number): void {
        const h = Math.hypot(nx, ny, nz);
        vec3.set(this.n, nx / h, ny / h, nz / h);
        this.d = d / h;
    }

    public getVec4v(dst: vec4): void {
        vec4.set(dst, this.n[0], this.n[1], this.n[2], this.d);
    }

    public setVec4v(v: ReadonlyVec4): void {
        vec3.set(this.n, v[0], v[1], v[2]);
        this.d = v[3];
    }

    public setTri(p0: ReadonlyVec3, p1: ReadonlyVec3, p2: ReadonlyVec3): void {
        const scratch = Plane.scratchVec3;
        vec3.sub(scratch[0], p1, p0);
        vec3.sub(scratch[1], p2, p0);
        vec3.cross(this.n, scratch[0], scratch[1]);
        vec3.normalize(this.n, this.n);
        this.d = -vec3.dot(this.n, p0);
    }

    public intersectLine(dst: vec3, p0: ReadonlyVec3, dir: ReadonlyVec3): void {
        const t = -(vec3.dot(this.n, p0) + this.d) / vec3.dot(this.n, dir);
        vec3.scaleAndAdd(dst, p0, dir, t);
    }

    // Compute point where line segment intersects plane
    public intersectLineSegment(dst: vec3, p0: ReadonlyVec3, p1: ReadonlyVec3) {
        const dir = Plane.scratchVec3[1];
        vec3.sub(dir, p1, p0);
        this.intersectLine(dst, p0, dir);
    }

    public transform(mtx: ReadonlyMat4): void {
        this.getVec4v(scratchVec4);
        mat4.invert(scratchMatrix, mtx);
        mat4.transpose(scratchMatrix, scratchMatrix);
        vec4.transformMat4(scratchVec4, scratchVec4, scratchMatrix);
        this.setVec4v(scratchVec4);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
export class AABB {
    public min = vec3.create();
    public max = vec3.create();

    constructor(
        minX: number = Infinity,
        minY: number = Infinity,
        minZ: number = Infinity,
        maxX: number = -Infinity,
        maxY: number = -Infinity,
        maxZ: number = -Infinity,
    ) {
        vec3.set(this.min, minX, minY, minZ);
        vec3.set(this.max, maxX, maxY, maxZ);
    }

    public transform(src: AABB, m: ReadonlyMat4): void {
        // Transforming Axis-Aligned Bounding Boxes from Graphics Gems.

        // Translation can be applied directly.
        getMatrixTranslation(scratchVec3a, m);
        getMatrixTranslation(scratchVec3b, m);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const a = m[i*4 + j] * src.min[i];
                const b = m[i*4 + j] * src.max[i];
                scratchVec3a[j] += Math.min(a, b);
                scratchVec3b[j] += Math.max(a, b);
            }
        }
        vec3.copy(this.min, scratchVec3a);
        vec3.copy(this.max, scratchVec3b);
    }

    public offset(src: AABB, offset: ReadonlyVec3): void {
        vec3.add(this.min, src.min, offset);
        vec3.add(this.max, src.max, offset);
    }

    public expandByExtent(src: AABB, extent: ReadonlyVec3): void {
        vec3.sub(this.min, src.min, extent);
        vec3.add(this.max, src.max, extent);
    }

    public set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        vec3.set(this.min, minX, minY, minZ);
        vec3.set(this.max, maxX, maxY, maxZ);
    }

    public reset(): void {
        vec3SetAll(this.min, Infinity);
        vec3SetAll(this.max, -Infinity);
    }

    public copy(other: AABB): void {
        vec3.copy(this.min, other.min);
        vec3.copy(this.max, other.max);
    }

    public clone(): AABB {
        const aabb = new AABB();
        aabb.copy(this);
        return aabb;
    }

    public setFromPoints(points: ReadonlyVec3[]): void {
        this.reset();

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            vec3.min(this.min, this.min, p);
            vec3.min(this.max, this.max, p);
        }
    }

    public union(a: AABB, b: AABB): void {
        vec3.min(this.min, a.min, b.min);
        vec3.max(this.max, a.max, b.max);
    }

    public unionPoint(v: ReadonlyVec3): boolean {
        let changed = false;

        if (v[0] < this.min[0]) {
            this.min[0] = v[0];
            changed = true;
        }

        if (v[1] < this.min[1]) {
            this.min[1] = v[1];
            changed = true;
        }

        if (v[2] < this.min[2]) {
            this.min[2] = v[2];
            changed = true;
        }

        if (v[0] > this.max[0]) {
            this.max[0] = v[0];
            changed = true;
        }

        if (v[1] > this.max[1]) {
            this.max[1] = v[1];
            changed = true;
        }

        if (v[2] > this.max[2]) {
            this.max[2] = v[2];
            changed = true;
        }

        return changed;
    }

    public static intersect(a: AABB, b: AABB): boolean {
        return !(
            a.min[0] > b.max[0] || b.min[0] > a.max[0] ||
            a.min[1] > b.max[1] || b.min[1] > a.max[1] ||
            a.min[2] > b.max[2] || b.min[2] > a.max[2]);
    }

    public containsPoint(v: ReadonlyVec3): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.min[0] || pX > this.max[0] ||
            pY < this.min[1] || pY > this.max[1] ||
            pZ < this.min[2] || pZ > this.max[2]);
    }

    public containsSphere(v: ReadonlyVec3, rad: number): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.min[0] - rad || pX > this.max[0] + rad ||
            pY < this.min[1] - rad || pY > this.max[1] + rad ||
            pZ < this.min[2] - rad || pZ > this.max[2] + rad);
    }

    public extents(v: vec3): void {
        v[0] = Math.max((this.max[0] - this.min[0]) / 2, 0);
        v[1] = Math.max((this.max[1] - this.min[1]) / 2, 0);
        v[2] = Math.max((this.max[2] - this.min[2]) / 2, 0);
    }

    public diagonalLengthSquared(): number {
        const dx = this.max[0] - this.min[0];
        const dy = this.max[1] - this.min[1];
        const dz = this.max[2] - this.min[2];
        return dx*dx + dy*dy + dz*dz;
    }

    public centerPoint(v: vec3): void {
        v[0] = (this.min[0] + this.max[0]) / 2;
        v[1] = (this.min[1] + this.max[1]) / 2;
        v[2] = (this.min[2] + this.max[2]) / 2;
    }

    public setFromCenterAndExtents(center: ReadonlyVec3, extents: ReadonlyVec3): void {
        vec3.sub(this.min, center, extents);
        vec3.add(this.max, center, extents);
    }

    public cornerPoint(dst: vec3, i: number): void {
        if (i === 0)
            vec3.set(dst, this.min[0], this.min[1], this.min[2]);
        else if (i === 1)
            vec3.set(dst, this.max[0], this.min[1], this.min[2]);
        else if (i === 2)
            vec3.set(dst, this.min[0], this.max[1], this.min[2]);
        else if (i === 3)
            vec3.set(dst, this.max[0], this.max[1], this.min[2]);
        else if (i === 4)
            vec3.set(dst, this.min[0], this.min[1], this.max[2]);
        else if (i === 5)
            vec3.set(dst, this.max[0], this.min[1], this.max[2]);
        else if (i === 6)
            vec3.set(dst, this.min[0], this.max[1], this.max[2]);
        else if (i === 7)
            vec3.set(dst, this.max[0], this.max[1], this.max[2]);
        else
            throw "whoops";
    }

    public boundingSphereRadius(): number {
        const extX = (this.max[0] - this.min[0]);
        const extY = (this.max[1] - this.min[1]);
        const extZ = (this.max[2] - this.min[2]);
        const chord = Math.hypot(extX, extY, extZ);
        return chord / 2;
    }

    public maxCornerRadius(): number {
        const x = Math.max(this.max[0], -this.min[0]);
        const y = Math.max(this.max[1], -this.min[1]);
        const z = Math.max(this.max[2], -this.min[2]);
        return Math.hypot(x, y, z);
    }

    public isEmpty(): boolean {
        this.extents(scratchVec3a);
        return scratchVec3a[0] === 0 && scratchVec3a[1] === 0 && scratchVec3a[2] === 0;
    }

    public distanceVec3(point: vec3): number {
        this.centerPoint(scratchVec3a);
        return vec3.distance(point, scratchVec3a);
    }
}

export enum IntersectionState {
    Inside,
    Outside,
    Intersection,
}

export class Frustum {
    private convexHull: ConvexHull;

    constructor(convexHull?: ConvexHull) {
        this.convexHull = convexHull ?? new rust.ConvexHull();
    }

    public updateClipFrustum(m: ReadonlyMat4, clipSpaceNearZ: GfxClipSpaceNearZ): void {
        // http://www8.cs.umu.se/kurser/5DV051/HT12/lab/plane_extraction.pdf
        // Note that we look down the -Z axis, rather than the +Z axis, so we have to invert all of our planes...

        const h = this.convexHull;
        h.clear();
        h.push_plane(-(m[3] + m[0]), -(m[7] + m[4]), -(m[11] + m[8]) , -(m[15] + m[12])); // Left
        h.push_plane(-(m[3] + m[1]), -(m[7] + m[5]), -(m[11] + m[9]) , -(m[15] + m[13])); // Top
        h.push_plane(-(m[3] - m[0]), -(m[7] - m[4]), -(m[11] - m[8]) , -(m[15] - m[12])); // Right
        h.push_plane(-(m[3] - m[1]), -(m[7] - m[5]), -(m[11] - m[9]) , -(m[15] - m[13])); // Bottom

        if (clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne) {
            h.push_plane(-(m[3] + m[2]), -(m[7] + m[6]), -(m[11] + m[10]), -(m[15] + m[14])); // Near
        } else if (clipSpaceNearZ === GfxClipSpaceNearZ.Zero) {
            h.push_plane(-(m[2]), -(m[6]), -(m[10]), -(m[14])); // Near
        }

        h.push_plane(-(m[3] - m[2]), -(m[7] - m[6]), -(m[11] - m[10]), -(m[15] - m[14])); // Far
    }

    public copy(o: Frustum): void {
        this.convexHull.free();
        this.convexHull = o.convexHull.copy();
    }

    public clone(): Frustum {
        return new Frustum(this.convexHull.copy());
    }

    public intersect(aabb: AABB): IntersectionState {
        return this.convexHull.js_intersect_aabb(aabb.min[0], aabb.min[1], aabb.min[2], aabb.max[0], aabb.max[1], aabb.max[2]);
    }

    public contains(aabb: AABB): boolean {
        return this.convexHull.js_contains_aabb(aabb.min[0], aabb.min[1], aabb.min[2], aabb.max[0], aabb.max[1], aabb.max[2]);
    }

    public containsSphere(v: ReadonlyVec3, radius: number): boolean {
        return this.convexHull.js_contains_sphere(v[0], v[1], v[2], radius);
    }

    public containsPoint(v: ReadonlyVec3): boolean {
        return this.convexHull.js_contains_point(v as Float32Array);
    }

    public transform(src: Frustum, m: ReadonlyMat4): void {
        this.copy(src);
        return this.convexHull.js_transform(m as Float32Array);
    }

    public getRust(): ConvexHull {
        return this.convexHull;
    }
}

/**
 * Computes the squared distance from a point {@param v} to the AABB {@param aabb}.
 * Will be 0 if the point is inside the AABB. Note that this is *not* the distance
 * to the the AABB's center point.
 */
export function squaredDistanceFromPointToAABB(v: vec3, aabb: AABB): number {
    const pX = v[0], pY = v[1], pZ = v[2];
    let sqDist = 0;

    if (pX < aabb.min[0])
        sqDist += (aabb.min[0] - pX) ** 2.0;
    else if (pX > aabb.max[1])
        sqDist += (pX - aabb.max[1]) ** 2.0;

    if (pY < aabb.min[1])
        sqDist += (aabb.min[1] - pY) ** 2.0;
    else if (pY > aabb.max[1])
        sqDist += (pY - aabb.max[1]) ** 2.0;

    if (pZ < aabb.min[2])
        sqDist += (aabb.min[2] - pZ) ** 2.0;
    else if (pZ > aabb.max[2])
        sqDist += (pZ - aabb.max[2]) ** 2.0;

    return sqDist;
}
