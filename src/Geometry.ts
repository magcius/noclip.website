
import { vec3, ReadonlyVec3, ReadonlyMat4, vec4, ReadonlyVec4, mat4 } from "gl-matrix";
import { IS_DEPTH_REVERSED } from "./gfx/helpers/ReversedDepthHelpers";
import { GfxClipSpaceNearZ } from "./gfx/platform/GfxPlatform";
import { nArray } from "./util";

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
    constructor(
        public minX: number = Infinity,
        public minY: number = Infinity,
        public minZ: number = Infinity,
        public maxX: number = -Infinity,
        public maxY: number = -Infinity,
        public maxZ: number = -Infinity,
    ) {}

    public transform(src: AABB, m: ReadonlyMat4): void {
        // Transforming Axis-Aligned Bounding Boxes from Graphics Gems.
        const srcMin = scratchVec3a, srcMax = scratchVec3b;
        vec3.set(srcMin, src.minX, src.minY, src.minZ);
        vec3.set(srcMax, src.maxX, src.maxY, src.maxZ);
        const dstMin = scratchVec3c, dstMax = scratchVec3d;

        // Translation can be applied directly.
        vec3.set(dstMin, m[12], m[13], m[14]);
        vec3.set(dstMax, m[12], m[13], m[14]);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const a = m[i*4 + j] * srcMin[i];
                const b = m[i*4 + j] * srcMax[i];
                dstMin[j] += Math.min(a, b);
                dstMax[j] += Math.max(a, b);
            }
        }

        this.minX = dstMin[0];
        this.minY = dstMin[1];
        this.minZ = dstMin[2];
        this.maxX = dstMax[0];
        this.maxY = dstMax[1];
        this.maxZ = dstMax[2];
    }

    public offset(src: AABB, offset: ReadonlyVec3): void {
        this.minX = src.minX + offset[0];
        this.minY = src.minY + offset[1];
        this.minZ = src.minZ + offset[2];
        this.maxX = src.maxX + offset[0];
        this.maxY = src.maxY + offset[1];
        this.maxZ = src.maxZ + offset[2];
    }

    public expandByExtent(src: AABB, extent: ReadonlyVec3): void {
        this.minX = src.minX - extent[0];
        this.minY = src.minY - extent[1];
        this.minZ = src.minZ - extent[2];
        this.maxX = src.maxX + extent[0];
        this.maxY = src.maxY + extent[1];
        this.maxZ = src.maxZ + extent[2];
    }

    public set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
    }

    public reset(): void {
        this.set(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    }

    public copy(other: AABB): void {
        this.set(other.minX, other.minY, other.minZ, other.maxX, other.maxY, other.maxZ);
    }

    public clone(): AABB {
        const aabb = new AABB();
        aabb.copy(this);
        return aabb;
    }

    public setFromPoints(points: vec3[]): void {
        this.minX = this.minY = this.minZ = Infinity;
        this.maxX = this.maxY = this.maxZ = -Infinity;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            this.minX = Math.min(this.minX, p[0]);
            this.minY = Math.min(this.minY, p[1]);
            this.minZ = Math.min(this.minZ, p[2]);
            this.maxX = Math.max(this.maxX, p[0]);
            this.maxY = Math.max(this.maxY, p[1]);
            this.maxZ = Math.max(this.maxZ, p[2]);
        }
    }

    public union(a: AABB, b: AABB): void {
        this.minX = Math.min(a.minX, b.minX);
        this.minY = Math.min(a.minY, b.minY);
        this.minZ = Math.min(a.minZ, b.minZ);
        this.maxX = Math.max(a.maxX, b.maxX);
        this.maxY = Math.max(a.maxY, b.maxY);
        this.maxZ = Math.max(a.maxZ, b.maxZ);
    }

    public unionPoint(v: ReadonlyVec3): boolean {
        let changed = false;

        if (v[0] < this.minX) {
            this.minX = v[0];
            changed = true;
        }

        if (v[1] < this.minY) {
            this.minY = v[1];
            changed = true;
        }

        if (v[2] < this.minZ) {
            this.minZ = v[2];
            changed = true;
        }

        if (v[0] > this.maxX) {
            this.maxX = v[0];
            changed = true;
        }

        if (v[1] > this.maxY) {
            this.maxY = v[1];
            changed = true;
        }

        if (v[2] > this.maxZ) {
            this.maxZ = v[2];
            changed = true;
        }

        return changed;
    }

    public static intersect(a: AABB, b: AABB): boolean {
        return !(
            a.minX > b.maxX || b.minX > a.maxX ||
            a.minY > b.maxY || b.minY > a.maxY ||
            a.minZ > b.maxZ || b.minZ > a.maxZ);
    }

    public containsPoint(v: ReadonlyVec3): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.minX || pX > this.maxX ||
            pY < this.minY || pY > this.maxY ||
            pZ < this.minZ || pZ > this.maxZ);
    }

    public containsSphere(v: ReadonlyVec3, rad: number): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.minX - rad || pX > this.maxX + rad ||
            pY < this.minY - rad || pY > this.maxY + rad ||
            pZ < this.minZ - rad || pZ > this.maxZ + rad);
    }

    public extents(v: vec3): void {
        v[0] = Math.max((this.maxX - this.minX) / 2, 0);
        v[1] = Math.max((this.maxY - this.minY) / 2, 0);
        v[2] = Math.max((this.maxZ - this.minZ) / 2, 0);
    }

    public diagonalLengthSquared(): number {
        const dx = this.maxX - this.minX;
        const dy = this.maxY - this.minY;
        const dz = this.maxZ - this.minZ;
        return dx*dx + dy*dy + dz*dz;
    }

    public centerPoint(v: vec3): void {
        v[0] = (this.minX + this.maxX) / 2;
        v[1] = (this.minY + this.maxY) / 2;
        v[2] = (this.minZ + this.maxZ) / 2;
    }


    public setFromCenterAndExtents(center: ReadonlyVec3, extents: ReadonlyVec3): void {
        this.minX = center[0] - extents[0];
        this.minY = center[1] - extents[1];
        this.minZ = center[2] - extents[2];
        this.maxX = center[0] + extents[0];
        this.maxY = center[1] + extents[1];
        this.maxZ = center[2] + extents[2];
    }

    public cornerPoint(dst: vec3, i: number): void {
        if (i === 0)
            vec3.set(dst, this.minX, this.minY, this.minZ);
        else if (i === 1)
            vec3.set(dst, this.maxX, this.minY, this.minZ);
        else if (i === 2)
            vec3.set(dst, this.minX, this.maxY, this.minZ);
        else if (i === 3)
            vec3.set(dst, this.maxX, this.maxY, this.minZ);
        else if (i === 4)
            vec3.set(dst, this.minX, this.minY, this.maxZ);
        else if (i === 5)
            vec3.set(dst, this.maxX, this.minY, this.maxZ);
        else if (i === 6)
            vec3.set(dst, this.minX, this.maxY, this.maxZ);
        else if (i === 7)
            vec3.set(dst, this.maxX, this.maxY, this.maxZ);
        else
            throw "whoops";
    }

    public boundingSphereRadius(): number {
        const extX = (this.maxX - this.minX);
        const extY = (this.maxY - this.minY);
        const extZ = (this.maxZ - this.minZ);
        const chord = Math.hypot(extX, extY, extZ);
        return chord / 2;
    }

    public maxCornerRadius(): number {
        const x = Math.max(this.maxX, -this.minX);
        const y = Math.max(this.maxY, -this.minY);
        const z = Math.max(this.maxZ, -this.minZ);
        return Math.sqrt(x*x + y*y + z*z);
    }

    public isEmpty(): boolean {
        this.extents(scratchVec3a);
        return scratchVec3a[0] === 0 && scratchVec3a[1] === 0 && scratchVec3a[2] === 0;
    }
}

class FrustumVisualizer {
    private canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public scale: number = 1/100000;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1080;
        this.canvas.height = 768;
        document.body.appendChild(this.canvas);
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.opacity = '0.5';
        this.canvas.style.pointerEvents = 'none';
        this.ctx = this.canvas.getContext('2d')!;
    }

    public newFrame(): void {
        this.ctx.fillStyle = 'white';
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    public dsx(n: number): number {
        return ((n*this.scale) + 0.5) * this.canvas.width;
    }

    public dsy(n: number): number {
        return ((n*this.scale) + 0.5) * this.canvas.height;
    }

    public daabb/* on the haters */(aabb: AABB): void {
        const x1 = this.dsx(aabb.minX);
        const y1 = this.dsy(aabb.minZ);
        const x2 = this.dsx(aabb.maxX);
        const y2 = this.dsy(aabb.maxZ);
        this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    public dsph(v: ReadonlyVec3, rad: number): void {
        const xc = this.dsx(v[0]);
        const yc = this.dsy(v[2]);
        this.ctx.beginPath();
        this.ctx.ellipse(xc, yc, rad*this.scale*this.canvas.width, rad*this.scale*this.canvas.height, 0, 0, Math.PI * 2);
        this.ctx.closePath();
        this.ctx.stroke();
    }
}

export enum IntersectionState {
    FULLY_INSIDE,
    FULLY_OUTSIDE,
    PARTIAL_INTERSECT,
}

export class Frustum {
    // Left, Right, Near, Far, Top, Bottom
    public planes: Plane[] = nArray(6, () => new Plane());

    private visualizer: FrustumVisualizer | null = null;
    public makeVisualizer(): FrustumVisualizer {
        if (this.visualizer === null)
            this.visualizer = new FrustumVisualizer();
        return this.visualizer;
    }

    private vizp(planes: Plane[], color: string): void {
        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = color;
            ctx.beginPath();
            const drawLine = (x1: number, z1: number, x2: number, z2: number) => {
                ctx.moveTo(this.visualizer!.dsx(x1), this.visualizer!.dsy(z1));
                ctx.lineTo(this.visualizer!.dsx(x2), this.visualizer!.dsy(z2));
            };
            const p0 = planes[0], p1 = planes[1], pn = planes[4];
            // Find the intersection of p0 & p1
            // line eq = ax + 0y + cz + d = 0
            const i0 = (p0.n[2]*p1.d - p0.d*p1.n[2]), i1 = (p0.d*p1.n[0] - p0.n[0]*p1.d), i2 = (p0.n[0]*p1.n[2] - p0.n[2]*p1.n[0]);
            const ix = i0/i2, iz = i1/i2;
            const G = 10;
            ctx.fillStyle = 'black';
            ctx.fillRect(this.visualizer!.dsx(ix) - G/2, this.visualizer!.dsy(iz) - G/2, G, G);
            const drawPlane = (p: Plane) => {
                // ax + 0y + cz + d = 0, solve for z, z = -(ax + d) / c
                const x1 = -100000, x2 = -x1;
                const z1 = -(p.d + p.n[0] * x1) / p.n[2];
                const z2 = -(p.d + p.n[0] * x2) / p.n[2];
                const dot = (pn.n[0]*x1 + pn.n[2]*z1);
                const px = dot >= 0 ? x2 : x1;
                const pz = dot >= 0 ? z2 : z1;
                drawLine(px, pz, ix, iz);
            };
            drawPlane(p0);
            drawPlane(p1);
            ctx.closePath();
            ctx.stroke();
        }
    }

    public updateClipFrustum(m: ReadonlyMat4, clipSpaceNearZ: GfxClipSpaceNearZ): void {
        // http://www8.cs.umu.se/kurser/5DV051/HT12/lab/plane_extraction.pdf
        // Note that we look down the -Z axis, rather than the +Z axis, so we have to invert all of our planes...

        this.planes[0].set4Unnormalized(-(m[3] + m[0]), -(m[7] + m[4]), -(m[11] + m[8]) , -(m[15] + m[12])); // Left
        this.planes[1].set4Unnormalized(-(m[3] - m[0]), -(m[7] - m[4]), -(m[11] - m[8]) , -(m[15] - m[12])); // Right
        this.planes[2].set4Unnormalized(-(m[3] + m[1]), -(m[7] + m[5]), -(m[11] + m[9]) , -(m[15] + m[13])); // Top
        this.planes[3].set4Unnormalized(-(m[3] - m[1]), -(m[7] - m[5]), -(m[11] - m[9]) , -(m[15] - m[13])); // Bottom

        if (clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne) {
            this.planes[4].set4Unnormalized(-(m[3] + m[2]), -(m[7] + m[6]), -(m[11] + m[10]), -(m[15] + m[14])); // Near
        } else if (clipSpaceNearZ === GfxClipSpaceNearZ.Zero) {
            this.planes[4].set4Unnormalized(-(m[2]), -(m[6]), -(m[10]), -(m[14])); // Near
        }

        this.planes[5].set4Unnormalized(-(m[3] - m[2]), -(m[7] - m[6]), -(m[11] - m[10]), -(m[15] - m[14])); // Far

        if (IS_DEPTH_REVERSED) {
            // swap
            this.planes[4].getVec4v(scratchVec4);
            this.planes[4].copy(this.planes[5]);
            this.planes[5].setVec4v(scratchVec4);
        }

        this.vizp(this.planes, 'green');
    }

    public _intersect(aabb: AABB): IntersectionState {
        let ret = IntersectionState.FULLY_INSIDE;
        // Test planes.
        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            // Nearest point to the frustum.
            const px = plane.n[0] >= 0 ? aabb.minX : aabb.maxX;
            const py = plane.n[1] >= 0 ? aabb.minY : aabb.maxY;
            const pz = plane.n[2] >= 0 ? aabb.minZ : aabb.maxZ;
            if (plane.distance(px, py, pz) > 0)
                return IntersectionState.FULLY_OUTSIDE;
            // Farthest point from the frustum.
            const fx = plane.n[0] >= 0 ? aabb.maxX : aabb.minX;
            const fy = plane.n[1] >= 0 ? aabb.maxY : aabb.minY;
            const fz = plane.n[2] >= 0 ? aabb.maxZ : aabb.minZ;
            if (plane.distance(fx, fy, fz) > 0)
                ret = IntersectionState.PARTIAL_INTERSECT;
        }

        return ret;
    }

    public intersect(aabb: AABB): IntersectionState {
        const res = this._intersect(aabb);

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = res === IntersectionState.FULLY_INSIDE ? 'black' : res === IntersectionState.FULLY_OUTSIDE ? 'red' : 'cyan';
            this.visualizer.daabb(aabb);
        }

        return res;
    }

    public contains(aabb: AABB): boolean {
        return this.intersect(aabb) !== IntersectionState.FULLY_OUTSIDE;
    }

    private _intersectSphere(v: ReadonlyVec3, radius: number): IntersectionState {
        let res = IntersectionState.FULLY_INSIDE;
        for (let i = 0; i < 6; i++) {
            const dist = this.planes[i].distance(v[0], v[1], v[2]);
            if (dist > radius)
                return IntersectionState.FULLY_OUTSIDE;
            else if (dist > -radius)
                res = IntersectionState.PARTIAL_INTERSECT;
        }

        return res;
    }

    public intersectSphere(v: ReadonlyVec3, radius: number): IntersectionState {
        const res = this._intersectSphere(v, radius);

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = res === IntersectionState.FULLY_INSIDE ? 'black' : res === IntersectionState.FULLY_OUTSIDE ? 'red' : 'cyan';
            this.visualizer.dsph(v, radius);
        }

        return res;
    }

    public containsSphere(v: ReadonlyVec3, radius: number): boolean {
        return this.intersectSphere(v, radius) !== IntersectionState.FULLY_OUTSIDE;
    }

    public containsPoint(v: ReadonlyVec3): boolean {
        for (let i = 0; i < 6; i++)
            if (this.planes[i].distance(v[0], v[1], v[2]) > 0)
                return false;

        return true;
    }

    public newFrame(): void {
        if (this.visualizer)
            this.visualizer.newFrame();
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

    if (pX < aabb.minX)
        sqDist += (aabb.minX - pX) ** 2.0;
    else if (pX > aabb.maxX)
        sqDist += (pX - aabb.maxX) ** 2.0;

    if (pY < aabb.minY)
        sqDist += (aabb.minY - pY) ** 2.0;
    else if (pY > aabb.maxY)
        sqDist += (pY - aabb.maxY) ** 2.0;

    if (pZ < aabb.minZ)
        sqDist += (aabb.minZ - pZ) ** 2.0;
    else if (pZ > aabb.maxZ)
        sqDist += (pZ - aabb.maxZ) ** 2.0;

    return sqDist;
}
