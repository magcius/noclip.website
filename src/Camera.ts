
import { mat4, vec3 } from 'gl-matrix';
import InputManager from './InputManager';
import { Frustum, AABB } from './Geometry';

export class Camera {
    public viewMatrix: mat4 = mat4.create();
    public worldMatrix: mat4 = mat4.create();
    public projectionMatrix: mat4 = mat4.create();
    public frustum: Frustum = new Frustum();
    public fovY: number;
    public aspect: number;

    public identity(): void {
        mat4.identity(this.worldMatrix);
        mat4.identity(this.viewMatrix);
    }

    public worldMatrixUpdated(): void {
        mat4.invert(this.viewMatrix, this.worldMatrix);
        this.frustum.updateWorldFrustum(this.worldMatrix);
    }

    public setPerspective(fovY: number, aspect: number, n: number, f: number): void {
        this.fovY = fovY;
        this.aspect = aspect;

        const nearY = Math.tan(fovY * 0.5) * n;
        const nearX = nearY * aspect;
        this.setFrustum(-nearX, nearX, -nearY, nearY, n, f);
    }

    public setClipPlanes(n: number, f: number): void {
        this.setPerspective(this.fovY, this.aspect, n, f);
    }

    private setFrustum(left: number, right: number, bottom: number, top: number, n: number, f: number): void {
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

const scratchVec3 = vec3.create();
export function computeViewSpaceDepth(camera: Camera, aabb: AABB, v: vec3 = scratchVec3): number {
    aabb.centerPoint(v);
    vec3.transformMat4(v, v, camera.viewMatrix);
    return Math.max(-v[2], 0);
}

export interface CameraController {
    camera: Camera;
    forceUpdate: boolean;
    cameraUpdateForced(): void;
    update(inputManager: InputManager, dt: number): boolean;
}

export interface CameraControllerClass {
    new(): CameraController;
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

function clampRange(v: number, lim: number): number {
    return clamp(v, -lim, lim);
}

const vec3Zero = [0, 0, 0];
export class FPSCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;

    private keyMovement = vec3.create();
    private tmp1: vec3 = vec3.create();
    private tmp2: vec3 = vec3.create();
    private speed: number;

    constructor() {
        this.speed = 60;
    }

    public cameraUpdateForced(): void {
        vec3.set(this.keyMovement, 0, 0, 0);
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const camera = this.camera;
        let updated = false;

        this.speed += inputManager.dz;
        this.speed = Math.max(this.speed, 1);

        let speedCap = this.speed;
        if (inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight'))
            speedCap *= 5;

        const movement = this.keyMovement;
        const tmp = this.tmp2;

        const velocity = speedCap / 5;
        const drag = 0.8;
        const lowSpeedCap = 0.01;

        if (inputManager.isKeyDown('KeyW')) {
            movement[2] = clampRange(movement[2] - velocity, speedCap);
        } else if (inputManager.isKeyDown('KeyS')) {
            movement[2] = clampRange(movement[2] + velocity, speedCap);
        } else {
            movement[2] *= drag;
            if (Math.abs(movement[2]) < lowSpeedCap) movement[2] = 0.0;
        }

        if (inputManager.isKeyDown('KeyA')) {
            movement[0] = clampRange(movement[0] - velocity, speedCap);
        } else if (inputManager.isKeyDown('KeyD')) {
            movement[0] = clampRange(movement[0] + velocity, speedCap);
        } else {
            movement[0] *= drag;
            if (Math.abs(movement[0]) < lowSpeedCap) movement[0] = 0.0;
        }

        if (inputManager.isKeyDown('KeyQ')) {
            movement[1] = clampRange(movement[1] - velocity, speedCap);
        } else if (inputManager.isKeyDown('KeyE')) {
            movement[1] = clampRange(movement[1] + velocity, speedCap);
        } else {
            movement[1] *= drag;
            if (Math.abs(movement[1]) < lowSpeedCap) movement[1] = 0.0;
        }

        if (inputManager.isKeyDown('KeyB')) {
            mat4.identity(camera.worldMatrix);
            updated = true;
        }

        // Rotate view.
        const dx = inputManager.getMouseDeltaX();
        const dy = inputManager.getMouseDeltaY();
        if (dx !== 0 || dy !== 0) {
            camera.getWorldUp(tmp);
            vec3.normalize(tmp, tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, -dx / 500.0, tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, -dy / 500.0, [1, 0, 0]);
            updated = true;
        }

        // Apply movement.
        if (!vec3.exactEquals(movement, vec3Zero)) {
            const finalMovement = this.tmp1;
            vec3.set(finalMovement, movement[0], 0, movement[2]);

            // Instead of getting the camera up, instead use world up. Feels more natural.
            camera.getWorldUp(tmp);
            vec3.scaleAndAdd(finalMovement, finalMovement, tmp, movement[1]);
            mat4.translate(camera.worldMatrix, camera.worldMatrix, finalMovement);
            updated = true;
        }

        updated = updated || this.forceUpdate;

        if (updated) {
            this.camera.worldMatrixUpdated();
            this.forceUpdate = false;
        }

        return updated;
    }
}

export class OrbitCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;

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
    public shouldOrbit: boolean = true;

    constructor() {
    }

    public cameraUpdateForced(): void {
    }

    public deserialize(state: string): void {
    }

    public update(inputManager: InputManager, dt: number): boolean {
        if (inputManager.isKeyDownEventTriggered('KeyG')) {
            this.shouldOrbit = !this.shouldOrbit;
        }

        const shouldOrbit = this.shouldOrbit;

        // Get new velocities from inputs.
        if (inputManager.button === 1) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) /  5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) / -5000;
        } else if (inputManager.isDragging()) {
            this.xVel += inputManager.dx / 200;
            this.yVel += inputManager.dy / 200;
        } else if (shouldOrbit) {
            if (this.xVel > -0.05)
                this.xVel -= 0.001;
        }
        this.zVel += inputManager.dz;
        if (inputManager.isKeyDown('KeyA')) {
            this.xVel += 0.05;
        }
        if (inputManager.isKeyDown('KeyD')) {
            this.xVel -= 0.05;
        }
        if (inputManager.isKeyDown('KeyW')) {
            this.yVel += 0.05;
        }
        if (inputManager.isKeyDown('KeyS')) {
            this.yVel -= 0.05;
        }
        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        const updated = this.forceUpdate || this.xVel !== 0 || this.yVel !== 0 || this.zVel !== 0;
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
            this.forceUpdate = false;
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

export function serializeMat4(dst: Float32Array, offs: number, m: mat4): number {
    dst[offs++] = m[0];
    dst[offs++] = m[4];
    dst[offs++] = m[8];
    dst[offs++] = m[12];
    dst[offs++] = m[1];
    dst[offs++] = m[5];
    dst[offs++] = m[9];
    dst[offs++] = m[13];
    dst[offs++] = m[2];
    dst[offs++] = m[6];
    dst[offs++] = m[10];
    dst[offs++] = m[14];
    return 4*3;
}

export function serializeCamera(dst: Float32Array, offs: number, camera: Camera): number {
    return serializeMat4(dst, offs, camera.worldMatrix);
}

export function deserializeCamera(camera: Camera, src: Float32Array, offs: number): number {
    const m = camera.worldMatrix;
    m[0]  = src[offs++];
    m[4]  = src[offs++];
    m[8]  = src[offs++];
    m[12] = src[offs++];
    m[1]  = src[offs++];
    m[5]  = src[offs++];
    m[9]  = src[offs++];
    m[13] = src[offs++];
    m[2]  = src[offs++];
    m[6]  = src[offs++];
    m[10] = src[offs++];
    m[14] = src[offs++];
    m[3]  = 0;
    m[7]  = 0;
    m[11] = 0;
    m[15] = 1;
    camera.worldMatrixUpdated();
    return 4*3;
}
