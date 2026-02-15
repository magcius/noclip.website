
import { vec3, ReadonlyVec3, ReadonlyMat4, vec4, ReadonlyVec4, mat4 } from "gl-matrix";
import { GfxClipSpaceNearZ } from "./gfx/platform/GfxPlatform.js";
import { assert, nArray } from "./util.js";
import type { ConvexHull } from "noclip-rust-support";
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

    public projectToPlane(dst: vec3, pt: ReadonlyVec3): void {
        vec3.scaleAndAdd(dst, pt, this.n, -this.distanceVec3(pt));
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

    /**
     * Sets this AABB to the result after transforming {@param src} by the matrix {@param m}.
     * Note that information loss is expected if rotated by non-90 degree increments, as an AABB
     * can grow larger when rotated and will never shrink; this loss can build up if repeatedly
     * transformed. As such, if wanting to transform an AABB by a chain of transformations, it is
     * always better to combine the transformations together and transform the AABB once, instead
     * of repeatedly transforming the AABB one at a time.
     */
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

    /**
     * Sets this AABB to the union of {@param a} and {@param b}.
     */
    public union(a: AABB, b: AABB): void {
        vec3.min(this.min, a.min, b.min);
        vec3.max(this.max, a.max, b.max);
    }

    /**
     * Sets this AABB to be the AABB formed by the set of all points given in {@param points}.
     */
    public setFromPoints(points: ReadonlyVec3[]): void {
        this.reset();

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            vec3.min(this.min, this.min, p);
            vec3.max(this.max, this.max, p);
        }
    }

    /**
     * Adds the point {@param v} to the AABB.
     * If the point was outside the AABB, the AABB is updated to contain the point and {@constant true} is returned.
     * Otherwise, the AABB is unchanged, and this function returns {@constant false}.
     */
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

    /**
     * Returns whether the two AABBs given by {@param a} and {@param b} overlap at all.
     */
    public static intersect(a: Readonly<AABB>, b: Readonly<AABB>): boolean {
        return !(
            a.min[0] > b.max[0] || b.min[0] > a.max[0] ||
            a.min[1] > b.max[1] || b.min[1] > a.max[1] ||
            a.min[2] > b.max[2] || b.min[2] > a.max[2]);
    }

    /**
     * Returns whether a point {@param v} is inside the bounds of this box.
     */
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

    /**
     * Retrieves the half-extents of this AABB into {@param dst}.
     */
    public getHalfExtents(dst: vec3): void {
        dst[0] = Math.max((this.max[0] - this.min[0]) * 0.5, 0);
        dst[1] = Math.max((this.max[1] - this.min[1]) * 0.5, 0);
        dst[2] = Math.max((this.max[2] - this.min[2]) * 0.5, 0);
    }

    /**
     * Returns the diagonal length.
     */
    public diagonalLengthSquared(): number {
        const dx = this.max[0] - this.min[0];
        const dy = this.max[1] - this.min[1];
        const dz = this.max[2] - this.min[2];
        return dx*dx + dy*dy + dz*dz;
    }

    /**
     * Returns the center point of this AABB into {@param dst}.
     */
    public centerPoint(dst: vec3): void {
        dst[0] = (this.min[0] + this.max[0]) / 2;
        dst[1] = (this.min[1] + this.max[1]) / 2;
        dst[2] = (this.min[2] + this.max[2]) / 2;
    }

    /**
     * Constructs an AABB given a center point {@param center} and a half-extents vector {@param halfExtents}.
     */
    public setFromCenterAndHalfExtents(center: ReadonlyVec3, halfExtents: ReadonlyVec3): void {
        vec3.sub(this.min, center, halfExtents);
        vec3.add(this.max, center, halfExtents);
    }

    /**
     * Returns a corner of the AABB, the specific one being given by {@param i}.
     * The corners will be returned in an arbitrary order.
     */
    public cornerPoint(dst: vec3, i: number): void {
        assert(i < 8, "An AABB only has eight corner points");
        dst[0] = (i & 0x01) ? this.min[0] : this.max[0];
        dst[1] = (i & 0x02) ? this.min[1] : this.max[1];
        dst[2] = (i & 0x04) ? this.min[2] : this.max[2];
    }

    /**
     * Returns the length of the half-diagonal vector of the AABB, which is also
     * the smallest radius of a sphere that surrounds this box.
     */
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

    /**
     * Returns whether an AABB has zero length on *all* axes. Does not necessarily imply it has 3D volume.
     */
    public isEmpty(): boolean {
        return this.min[0] >= this.max[0] && this.min[1] >= this.max[1] && this.min[2] >= this.max[2];
    }

    /**
     * Returns the distance from the center of this AABB to an arbitrary point {@param v}.
     */
    public distFromCenter(v: ReadonlyVec3): number {
        this.centerPoint(scratchVec3a);
        return vec3.distance(v, scratchVec3a);
    }

    /**
     * Returns the squared distance from {@param v} to the point closest to {@param v} on this AABB.
     * Will be 0 if the point is inside the AABB.
     */
    public sqDistFromClosestPoint(v: ReadonlyVec3): number {
        const pX = v[0], pY = v[1], pZ = v[2];
        let sqDist = 0;

        if (pX < this.min[0])
            sqDist += (this.min[0] - pX) ** 2.0;
        else if (pX > this.max[1])
            sqDist += (pX - this.max[1]) ** 2.0;

        if (pY < this.min[1])
            sqDist += (this.min[1] - pY) ** 2.0;
        else if (pY > this.max[1])
            sqDist += (pY - this.max[1]) ** 2.0;

        if (pZ < this.min[2])
            sqDist += (this.min[2] - pZ) ** 2.0;
        else if (pZ > this.max[2])
            sqDist += (pZ - this.max[2]) ** 2.0;

        return sqDist;
    }

    /**
     * Returns the distance from {@param v} to the point closest to {@param v} on this AABB.
     * Will return 0 if the point is inside the AABB.
     */
    public distFromClosestPoint(v: ReadonlyVec3): number {
        return Math.sqrt(this.sqDistFromClosestPoint(v));
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

        const h = this.convexHull;
        h.clear();
        h.push_plane(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); // Left
        h.push_plane(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); // Top
        h.push_plane(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]); // Right
        h.push_plane(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]); // Bottom

        if (clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne) {
            h.push_plane(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); // Near
        } else if (clipSpaceNearZ === GfxClipSpaceNearZ.Zero) {
            h.push_plane(m[2], m[6], m[10], m[14]); // Near
        }

        h.push_plane(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]); // Far
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
