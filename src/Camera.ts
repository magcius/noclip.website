
import { mat4, vec3, quat, vec4 } from 'gl-matrix';
import { InputManager } from './InputManager';
import { nArray } from './util';

class Plane {
    private static scratchVec3: vec3[] = nArray(2, () => vec3.create());
    // Plane normal
    public x: number;
    public y: number;
    public z: number;
    // Distance
    public d: number;

    public test(x: number, y: number, z: number): number {
        const dot = x*this.x + y*this.y + z*this.z;
        return this.d + dot;
    }

    public set(p0: vec3, p1: vec3, p2: vec3): void {
        const scratch = Plane.scratchVec3;
        vec3.sub(scratch[0], p2, p0);
        vec3.sub(scratch[1], p1, p0);
        vec3.cross(scratch[0], scratch[0], scratch[1]);
        vec3.normalize(scratch[0], scratch[0]);
        this.x = scratch[0][0];
        this.y = scratch[0][1];
        this.z = scratch[0][2];
        this.d = -vec3.dot(scratch[0], p0);
    }
}

export class AABB {
    constructor(
        public minX: number = 0,
        public minY: number = 0,
        public minZ: number = 0,
        public maxX: number = 0,
        public maxY: number = 0,
        public maxZ: number = 0,
    ) {}

    public normalize(): void {
        if (this.minX > this.maxX) {
            const t = this.minX;
            this.minX = this.maxX;
            this.maxX = t;
        }
        if (this.minY > this.maxY) {
            const t = this.minY;
            this.minY = this.maxY;
            this.maxY = t;
        }
        if (this.minZ > this.maxZ) {
            const t = this.minZ;
            this.minZ = this.maxZ;
            this.maxZ = t;
        }
    }

    public transform(src: AABB, m: mat4): void {
        this.minX = m[0]*src.minX + m[4]*src.minY + m[8]*src.minZ + m[12];
        this.minY = m[1]*src.minX + m[5]*src.minY + m[9]*src.minZ + m[13];
        this.minZ = m[2]*src.minX + m[6]*src.minY + m[10]*src.minZ + m[14];
        this.maxX = m[0]*src.maxX + m[4]*src.maxY + m[8]*src.maxZ + m[12];
        this.maxY = m[1]*src.maxX + m[5]*src.maxY + m[9]*src.maxZ + m[13];
        this.maxZ = m[2]*src.maxX + m[6]*src.maxY + m[10]*src.maxZ + m[14];
        // Normalize, as the matrix mult can possibly reverse things.
        this.normalize();
    }

    public set(points: vec3[]): void {
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

    public static intersect(a: AABB, b: AABB): boolean {
        return !(
            a.minX > b.maxX || b.minX > a.maxX ||
            a.minY > b.maxY || b.minY > a.maxY ||
            a.minZ > b.maxZ || b.minZ > a.maxZ);
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
        this.ctx = this.canvas.getContext('2d');
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
}

export enum IntersectionState {
    FULLY_INSIDE,
    FULLY_OUTSIDE,
    PARTIAL_INTERSECT,
}

class Frustum {
    private static scratchPlaneVec3 = nArray(9, () => vec3.create());

    // View-space configuration.
    public left: number;
    public right: number;
    public bottom: number;
    public top: number;
    public near: number;
    public far: number;

    // World-space configuration.
    public aabb: AABB = new AABB();
    // Left, Right, Near, Far, Top, Bottom
    public planes: Plane[] = nArray(6, () => new Plane());

    private visualizer: FrustumVisualizer | null = null;
    public makeVisualizer(): void {
        this.visualizer = new FrustumVisualizer();
    }

    public setViewFrustum(left: number, right: number, bottom: number, top: number, n: number, f: number): void {
        this.left = left;
        this.right = right;
        this.bottom = bottom;
        this.top = top;
        this.near = -n;
        this.far = -f;
    }

    public updateWorldFrustum(worldMatrix: mat4): void {
        const scratch = Frustum.scratchPlaneVec3;

        const fn = this.far / this.near;
        vec3.set(scratch[0], this.left, this.top, this.near);
        vec3.set(scratch[1], this.right, this.top, this.near);
        vec3.set(scratch[2], this.right, this.bottom, this.near);
        vec3.set(scratch[3], this.left, this.bottom, this.near);
        vec3.set(scratch[4], fn * this.left, fn * this.top, this.far);
        vec3.set(scratch[5], fn * this.right, fn * this.top, this.far);
        vec3.set(scratch[6], fn * this.right, fn * this.bottom, this.far);
        vec3.set(scratch[7], fn * this.left, fn * this.bottom, this.far);
        vec3.set(scratch[8], 0, 0, 0);

        for (let i = 0; i < 9; i++)
            vec3.transformMat4(scratch[i], scratch[i], worldMatrix);

        this.aabb.set(scratch);

        this.planes[0].set(scratch[8], scratch[3], scratch[0]); // left plane
        this.planes[1].set(scratch[8], scratch[1], scratch[2]); // right plane
        this.planes[2].set(scratch[0], scratch[1], scratch[2]); // near plane
        this.planes[3].set(scratch[4], scratch[7], scratch[6]); // far plane
        this.planes[4].set(scratch[8], scratch[0], scratch[1]); // top plane
        this.planes[5].set(scratch[8], scratch[2], scratch[3]); // bottom plane

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            const scale = this.visualizer.scale;
            // TODO(jstpierre): why isn't this working?
            ctx.setTransform(1, 0, 0, 1, -worldMatrix[12]*scale, -worldMatrix[14]*scale);
            ctx.strokeStyle = 'red';
            this.visualizer.daabb(this.aabb);

            vec3.set(scratch[0], this.left, 0, this.near);
            vec3.set(scratch[1], this.right, 0, this.near);
            vec3.set(scratch[2], fn * this.right, 0, this.far);
            vec3.set(scratch[3], fn * this.left, 0, this.far);

            ctx.strokeStyle = 'green';
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const p = scratch[i];
                vec3.transformMat4(p, p, worldMatrix);
                const x = this.visualizer.dsx(p[0]);
                const y = this.visualizer.dsy(p[2]);
                ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }

    public _intersect(aabb: AABB): IntersectionState {
        if (!AABB.intersect(this.aabb, aabb))
            return IntersectionState.FULLY_OUTSIDE;

        let ret = IntersectionState.FULLY_INSIDE;

        // Test planes.
        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            // Nearest point to the frustum.
            const px = plane.x >= 0 ? aabb.minX : aabb.maxX;
            const py = plane.y >= 0 ? aabb.minY : aabb.maxY;
            const pz = plane.z >= 0 ? aabb.minZ : aabb.maxZ;
            if (plane.test(px, py, pz) > 0)
                return IntersectionState.FULLY_OUTSIDE;
            // Farthest point from the frustum.
            const fx = plane.x >= 0 ? aabb.maxX : aabb.minX;
            const fy = plane.y >= 0 ? aabb.maxY : aabb.minY;
            const fz = plane.z >= 0 ? aabb.maxZ : aabb.minZ;
            if (plane.test(fx, fy, fz) > 0)
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

    public newFrame(): void {
        if (this.visualizer)
            this.visualizer.newFrame();
    }
}

export class Camera {
    public viewMatrix: mat4 = mat4.create();
    public worldMatrix: mat4 = mat4.create();
    public projectionMatrix: mat4 = mat4.create();
    public frustum: Frustum = new Frustum();

    public identity(): void {
        mat4.identity(this.worldMatrix);
        mat4.identity(this.viewMatrix);
    }

    public worldMatrixUpdated(): void {
        mat4.invert(this.viewMatrix, this.worldMatrix);
        this.frustum.updateWorldFrustum(this.worldMatrix);
    }

    public setPerspective(fovY: number, aspect: number, n: number, f: number): void {
        const nearY = Math.tan(fovY * 0.5) * n;
        const nearX = nearY * aspect;
        this.setFrustum(-nearX, nearX, -nearY, nearY, n, f);
    }

    public setFrustum(left: number, right: number, bottom: number, top: number, n: number, f: number): void {
        this.frustum.setViewFrustum(left, right, bottom, top, n, f);
        this.frustum.updateWorldFrustum(this.worldMatrix);
        mat4.frustum(this.projectionMatrix, left, right, bottom, top, n, f);
    }

    public newFrame(): void {
        this.frustum.newFrame();
    }

    // For documentation more than anything.
    public getWorldRight(out: vec3): void {
        vec3.set(out, this.worldMatrix[0], this.worldMatrix[4], this.worldMatrix[8]);
    }

    public getWorldUp(out: vec3): void {
        vec3.set(out, this.worldMatrix[1], this.worldMatrix[5], this.worldMatrix[9]);
    }

    public getWorldForward(out: vec3): void {
        vec3.set(out, this.worldMatrix[2], this.worldMatrix[6], this.worldMatrix[10]);
    }
}

export function computeViewMatrix(out: mat4, camera: Camera): void {
    mat4.copy(out, camera.viewMatrix);
}

export function computeViewMatrixSkybox(out: mat4, camera: Camera): void {
    mat4.copy(out, camera.viewMatrix);
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
}

export function computeModelMatrixBillboard(out: mat4, camera: Camera): void {
    mat4.identity(out);

    // Right vector
    out[0] = camera.worldMatrix[0];
    out[4] = camera.worldMatrix[4];
    out[8] = camera.worldMatrix[8];

    // Up vector
    out[1] = camera.worldMatrix[1];
    out[5] = camera.worldMatrix[5];
    out[9] = camera.worldMatrix[9];

    // Forward vector
    out[2] = camera.worldMatrix[2];
    out[6] = camera.worldMatrix[6];
    out[8] = camera.worldMatrix[8];
}

export function computeModelMatrixYBillboard(out: mat4, camera: Camera): void {
    mat4.identity(out);

    // Right vector
    out[0] = camera.worldMatrix[0];
    out[4] = camera.worldMatrix[4];
    out[8] = camera.worldMatrix[8];

    // Forward vector
    out[2] = camera.worldMatrix[2];
    out[6] = camera.worldMatrix[6];
    out[8] = camera.worldMatrix[8];
}

export interface CameraController {
    camera: Camera;
    serialize(): string;
    deserialize(state: string): void;
    update(inputManager: InputManager, dt: number): boolean;
}

export interface CameraControllerClass {
    new(): CameraController;
}

export class FPSCameraController implements CameraController {
    public camera: Camera;

    private tmp1: vec3 = vec3.create();
    private tmp2: vec3 = vec3.create();
    private speed: number;

    constructor() {
        this.speed = 10;
    }

    public serialize(): string {
        const camera = this.camera;
        const tx = camera.worldMatrix[12], ty = camera.worldMatrix[13], tz = camera.worldMatrix[14];
        const rx = camera.worldMatrix[0], ry = camera.worldMatrix[4], rz = camera.worldMatrix[8];
        const fx = camera.worldMatrix[2], fy = camera.worldMatrix[6], fz = camera.worldMatrix[10];
        return `${tx.toFixed(2)},${ty.toFixed(2)},${tz.toFixed(2)},${fx.toFixed(2)},${fy.toFixed(2)},${fz.toFixed(2)},${rx.toFixed(2)},${ry.toFixed(2)},${rz.toFixed(2)}`;
    }

    public deserialize(state: string) {
        const [tx, ty, tz, fx, fy, fz, rx, ry, rz] = state.split(',');
        // Translation.
        this.camera.worldMatrix[12] = +tx;
        this.camera.worldMatrix[13] = +ty;
        this.camera.worldMatrix[14] = +tz;
        this.camera.worldMatrix[2] = +fx;
        this.camera.worldMatrix[6] = +fy;
        this.camera.worldMatrix[10] = +fz;
        this.camera.worldMatrix[0] = +rx;
        this.camera.worldMatrix[4] = +ry;
        this.camera.worldMatrix[8] = +rz;
        const u = vec3.create();
        vec3.cross(u, [this.camera.worldMatrix[2], this.camera.worldMatrix[6], this.camera.worldMatrix[10]], [this.camera.worldMatrix[0], this.camera.worldMatrix[4], this.camera.worldMatrix[8]]);
        vec3.normalize(u, u);
        this.camera.worldMatrix[1] = u[0];
        this.camera.worldMatrix[5] = u[1];
        this.camera.worldMatrix[9] = u[2];
        this.camera.worldMatrixUpdated();
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const camera = this.camera;
        let updated = false;

        this.speed += inputManager.dz;
        this.speed = Math.max(this.speed, 1);

        let mult = this.speed;
        if (inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight'))
            mult *= 5;
        mult *= (dt / 16.0);

        const movement = this.tmp1;
        vec3.set(movement, 0, 0, 0);

        const tmp = this.tmp2;

        let amt;
        amt = 0;
        if (inputManager.isKeyDown('KeyW')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('KeyS')) {
            amt = mult;
        }
        if (amt !== 0) {
            movement[2] = amt;
        }

        amt = 0;
        if (inputManager.isKeyDown('KeyA')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('KeyD')) {
            amt = mult;
        }
        if (amt !== 0) {
            movement[0] = amt;
        }

        amt = 0;
        if (inputManager.isKeyDown('KeyQ')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('KeyE')) {
            amt = mult;
        }
        if (amt !== 0) {
            // Instead of getting the camera up, instead use world up. Feels more natural.
            camera.getWorldUp(tmp);
            vec3.scaleAndAdd(movement, movement, tmp, amt);
            updated = true;
        }

        if (inputManager.isKeyDown('KeyB')) {
            mat4.identity(camera.worldMatrix);
            updated = true;
        }
        if (inputManager.isKeyDown('KeyC')) {
            console.log(camera);
        }

        // Rotate view.
        const dx = inputManager.dx;
        const dy = inputManager.dy;
        if (dx !== 0 || dy !== 0) {
            camera.getWorldUp(tmp);
            vec3.normalize(tmp, tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, -dx / 500.0, tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, -dy / 500.0, [1, 0, 0]);
            updated = true;
        }

        if (!vec3.exactEquals(movement, [0, 0, 0])) {
            mat4.translate(camera.worldMatrix, camera.worldMatrix, movement);
            updated = true;
        }

        if (updated) {
            this.camera.worldMatrixUpdated();
        }

        return updated;
    }
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

function clampRange(v: number, lim: number): number {
    return clamp(v, -lim, lim);
}

export class OrbitCameraController implements CameraController {
    public camera: Camera;

    public x: number = 0.15;
    public y: number = 0.35;
    public z: number = -150;
    public xVel: number = 0;
    public yVel: number = 0;
    public zVel: number = 0;

    public tx: number = 0;
    public ty: number = 0;
    public txVel: number = 0;
    public tyVel: number = 0;

    constructor() {
    }

    public serialize(): string {
        return '';
    }

    public deserialize(state: string): void {
    }

    public update(inputManager: InputManager, dt: number): boolean {
        // Get new velocities from inputs.
        if (inputManager.button === 1) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) /  5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) / -5000;
        } else {
            this.xVel += inputManager.dx / 200;
            this.yVel += inputManager.dy / 200;
        }
        this.zVel += inputManager.dz;
        if (inputManager.isKeyDown('A')) {
            this.xVel += 0.05;
        }
        if (inputManager.isKeyDown('D')) {
            this.xVel -= 0.05;
        }
        if (inputManager.isKeyDown('W')) {
            this.yVel += 0.05;
        }
        if (inputManager.isKeyDown('S')) {
            this.yVel -= 0.05;
        }
        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        const updated = this.xVel !== 0 || this.yVel !== 0 || this.zVel !== 0;
        if (updated) {
            // Apply velocities.
            const drag = inputManager.isDragging() ? 0.92 : 0.96;

            this.x += this.xVel / 10;
            this.xVel *= drag;

            this.y += this.yVel / 10;
            this.yVel *= drag;

            this.tx += this.txVel;
            this.txVel *= drag;

            this.ty += this.tyVel;
            this.tyVel *= drag;

            if (this.y < 0.04) {
                this.y = 0.04;
                this.yVel = 0;
            }
            if (this.y > 1.50) {
                this.y = 1.50;
                this.yVel = 0;
            }

            this.z += this.zVel;
            this.zVel *= 0.8;
            if (this.z > -10) {
                this.z = -10;
                this.zVel = 0;
            }

            const camera = this.camera;

            // Calculate new camera from new x/y/z.
            const sinX = Math.sin(this.x);
            const cosX = Math.cos(this.x);
            const sinY = Math.sin(this.y);
            const cosY = Math.cos(this.y);
            // TODO(jstpierre): Replace this with position/look direction.
            mat4.set(camera.worldMatrix,
                cosX, sinY * sinX, -cosY * sinX, 0,
                0, cosY, sinY, 0,
                sinX, -sinY * cosX, cosY * cosX, 0,
                this.tx, this.ty, this.z, 1
            );
            mat4.invert(camera.worldMatrix, camera.worldMatrix);
            this.camera.worldMatrixUpdated();
        }

        return updated;
    }
}

// Probably don't belong in here, but are helpful nonetheless.
export function texProjPerspMtx(dst: mat4, fov: number, aspect: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const cot = 1 / Math.tan(fov / 2);

    dst[0] = (cot / aspect) * scaleS;
    dst[4] = 0.0;
    dst[8] = -transS;
    dst[12] = 0.0;

    dst[1] = 0.0;
    dst[5] = cot * scaleT;
    dst[9] = -transT;
    dst[13] = 0.0;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = -1.0;
    dst[14] = 0.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function texEnvMtx(dst: mat4, scaleS: number, scaleT: number, transS: number, transT: number) {
    dst[0] = scaleS;
    dst[4] = 0.0;
    dst[8] = 0.0;
    dst[12] = transS;

    dst[1] = 0.0;
    dst[5] = -scaleT;
    dst[9] = 0.0;
    dst[13] = transT;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 0.0;
    dst[14] = 1.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}
