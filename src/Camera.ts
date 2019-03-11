
import { mat4, vec3, vec4 } from 'gl-matrix';
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
const scratchVec4 = vec4.create();

/**
 * Computes a view-space depth given @param camera and @param aabb in world-space.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 * The returned value can be passed directly to {@link GfxRenderer.setSortKeyDepth}.
 */
export function computeViewSpaceDepthFromWorldSpaceAABB(camera: Camera, aabb: AABB, v: vec3 = scratchVec3): number {
    aabb.centerPoint(v);
    return computeViewSpaceDepthFromWorldSpacePoint(camera, v);
}

/**
 * Computes a view-space depth given @param camera and @param v in world-space.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 * The returned value can be passed directly to {@link GfxRenderer.setSortKeyDepth}.
 */
export function computeViewSpaceDepthFromWorldSpacePoint(camera: Camera, v: vec3): number {
    vec3.transformMat4(v, v, camera.viewMatrix);
    return Math.max(-v[2], 0);
}

export function divideByW(dst: vec4, src: vec4): void {
    dst[0] = src[0] / src[3];
    dst[1] = src[1] / src[3];
    dst[2] = src[2] / src[3];
    dst[3] = 1.0;
}

export class ScreenSpaceProjection {
    // These values are in "flat clip space" (that is, -1 corresponds to the left frustum plane,
    // and +1 corresponds to the right frustum plane). If the projected area extends beyond these
    // planes, then these values might go less than -1 or greater than +1. This is normal.
    public projectedMinX!: number;
    public projectedMinY!: number;
    public projectedMaxX!: number;
    public projectedMaxY!: number;

    constructor() {
        this.reset();
    }

    public reset(): void {
        this.projectedMinX = Infinity;
        this.projectedMinY = Infinity;
        this.projectedMaxX = -Infinity;
        this.projectedMaxY = -Infinity;
    }

    /**
     * Returns the screen area, in normalized units, of the projection as a measure from 0 to 1.
     *
     * It is possible for this measure to return greater than 1, if a box that is larger than the
     * whole screen is computed. You need to clamp manually if you do not want this to happen.
     */
    public getScreenArea(): number {
        const extX = (this.projectedMaxX - this.projectedMinX) * 0.5;
        const extY = (this.projectedMaxY - this.projectedMinY) * 0.5;
        return extX * extY;
    }

    public union(projectedX: number, projectedY: number): void {
        this.projectedMinX = Math.min(this.projectedMinX, projectedX);
        this.projectedMinY = Math.min(this.projectedMinY, projectedY);
        this.projectedMaxX = Math.max(this.projectedMaxX, projectedX);
        this.projectedMaxY = Math.max(this.projectedMaxY, projectedY);
    }
}

/**
 * Computes the area, in screen space (normalized screen space from 0 to 1), that
 * a sphere in world-space coordinates with parameters @param center and @param radius
 * will take up when viewed by @param camera.
 */
export function computeScreenSpaceProjectionFromWorldSpaceSphere(screenSpaceProjection: ScreenSpaceProjection, camera: Camera, center: vec3, radius: number, v: vec3 = scratchVec3, v4: vec4 = scratchVec4): void {
    screenSpaceProjection.reset();

    vec3.transformMat4(v, center, camera.viewMatrix);

    v[2] = -Math.max(Math.abs(v[2] - radius), camera.frustum.near);

    const viewCenterX = v[0], viewCenterY = v[1], viewCenterZ = v[2];

    // Compute the corners of screen-space square that encloses the sphere.
    for (let xs = -1; xs <= 1; xs += 2) {
        for (let ys = -1; ys <= 1; ys += 2) {
            vec4.set(v4, viewCenterX + radius*xs, viewCenterY + radius*ys, viewCenterZ, 1.0);
            vec4.transformMat4(v4, v4, camera.projectionMatrix);
            divideByW(v4, v4);
            screenSpaceProjection.union(v4[0], v4[1]);
        }
    }
}

/**
 * Computes the area, in screen space (normalized screen space from 0 to 1), that
 * world-space AABB @param aabb will take up when viewed by @param camera.
 */
export function computeScreenSpaceProjectionFromWorldSpaceAABB(screenSpaceProjection: ScreenSpaceProjection, camera: Camera, aabb: AABB, v: vec3 = scratchVec3, v4: vec4 = scratchVec4): void {
    const radius = aabb.boundingSphereRadius();

    // Compute view-space center.
    aabb.centerPoint(v);

    return computeScreenSpaceProjectionFromWorldSpaceSphere(screenSpaceProjection, camera, v, radius, v, v4);
}

export interface CameraController {
    camera: Camera;
    forceUpdate: boolean;
    setKeyMoveSpeed(speed: number): void;
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
    private mouseMovement = vec3.create();
    private tmp1: vec3 = vec3.create();
    private tmp2: vec3 = vec3.create();

    private keyMoveSpeed = 60;
    private keyMoveShiftMult = 5;
    private keyMoveVelocityMult = 1/5;
    private keyMoveDrag = 0.8;

    private mouseLookSpeed = 500;
    private mouseLookDragFast = 0;
    private mouseLookDragSlow = 0;

    public cameraUpdateForced(): void {
        vec3.set(this.keyMovement, 0, 0, 0);
    }

    public setKeyMoveSpeed(speed: number): void {
        this.keyMoveSpeed = speed;
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const camera = this.camera;
        let updated = false;

        if (inputManager.isKeyDown('KeyB')) {
            mat4.identity(camera.worldMatrix);
            this.cameraUpdateForced();
            updated = true;
        }

        this.keyMoveSpeed = Math.max(this.keyMoveSpeed, 1);
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight') || inputManager.getGamepadButton(6) || inputManager.getGamepadButton(7);

        let keyMoveMult = 1;
        if (isShiftPressed)
            keyMoveMult = this.keyMoveShiftMult;

        let keyMoveSpeedCap = this.keyMoveSpeed * keyMoveMult;
        const keyMoveVelocity = keyMoveSpeedCap * this.keyMoveVelocityMult;
    
        const keyMovement = this.keyMovement;
        const tmp = this.tmp2;

        const keyMoveLowSpeedCap = 0.01;

        if (inputManager.isKeyDown('KeyW') || inputManager.isKeyDown('ArrowUp')) {
            keyMovement[2] = clampRange(keyMovement[2] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyS') || inputManager.isKeyDown('ArrowDown')) {
            keyMovement[2] = clampRange(keyMovement[2] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(inputManager.getGamepadAxis(1)) > 0.5) {
            keyMovement[2] = clampRange(keyMovement[2] + keyMoveVelocity * inputManager.getGamepadAxis(1), keyMoveSpeedCap);
        } else {
            keyMovement[2] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[2]) < keyMoveLowSpeedCap) keyMovement[2] = 0.0;
        }

        if (inputManager.isKeyDown('KeyA') || inputManager.isKeyDown('ArrowLeft')) {
            keyMovement[0] = clampRange(keyMovement[0] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyD') || inputManager.isKeyDown('ArrowRight')) {
            keyMovement[0] = clampRange(keyMovement[0] + keyMoveVelocity, keyMoveSpeedCap);
            keyMovement[0] = clampRange(keyMovement[0] + keyMoveVelocity * inputManager.getGamepadAxis(0), keyMoveSpeedCap);
        } else {
            keyMovement[0] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[0]) < keyMoveLowSpeedCap) keyMovement[0] = 0.0;
        }

        if (inputManager.isKeyDown('KeyQ') || inputManager.isKeyDown('PageDown') || (inputManager.isKeyDown('ControlLeft') && inputManager.isKeyDown('Space')) || inputManager.getGamepadButton(0)) {
            keyMovement[1] = clampRange(keyMovement[1] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyE') || inputManager.isKeyDown('PageUp') || inputManager.isKeyDown('Space') || inputManager.getGamepadButton(1)) {
            keyMovement[1] = clampRange(keyMovement[1] + keyMoveVelocity, keyMoveSpeedCap);
        } else {
            keyMovement[1] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[1]) < keyMoveLowSpeedCap) keyMovement[1] = 0.0;
        }

        if (!vec3.exactEquals(keyMovement, vec3Zero)) {
            const finalMovement = this.tmp1;
            vec3.set(finalMovement, keyMovement[0], 0, keyMovement[2]);

            // Instead of getting the camera up, instead use world up. Feels more natural.
            camera.getWorldUp(tmp);
            vec3.scaleAndAdd(finalMovement, finalMovement, tmp, keyMovement[1]);
            mat4.translate(camera.worldMatrix, camera.worldMatrix, finalMovement);
            updated = true;
        }

        const mouseMoveLowSpeedCap = 0.0001;

        const invertYMult = inputManager.invertY ? -1 : 1;
        const dx = (inputManager.getMouseDeltaX() || (Math.abs(inputManager.getGamepadAxis(2)) > 0.2 && inputManager.getGamepadAxis(2) * 50)) * (-1 / this.mouseLookSpeed);
        const dy = (inputManager.getMouseDeltaY() || (Math.abs(inputManager.getGamepadAxis(3)) > 0.2 && inputManager.getGamepadAxis(3) * 50)) * (-1 / this.mouseLookSpeed) * invertYMult;

        

        const mouseMovement = this.mouseMovement;
        mouseMovement[0] += dx;
        mouseMovement[1] += dy;

        const keyAngleChangeVel = isShiftPressed ? 0.1 : 0.04;
        if (inputManager.isKeyDown('KeyJ'))
            mouseMovement[0] += keyAngleChangeVel;
        else if (inputManager.isKeyDown('KeyL'))
            mouseMovement[0] -= keyAngleChangeVel;
        if (inputManager.isKeyDown('KeyI'))
            mouseMovement[1] += keyAngleChangeVel * invertYMult;
        else if (inputManager.isKeyDown('KeyK'))
            mouseMovement[1] -= keyAngleChangeVel * invertYMult;

        if (!vec3.exactEquals(this.mouseMovement, vec3Zero)) {
            camera.getWorldUp(tmp);
            vec3.normalize(tmp, tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[0], tmp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[1], [1, 0, 0]);
            updated = true;
        }

        if (inputManager.isDragging()) {
            vec3.scale(this.mouseMovement, this.mouseMovement, this.mouseLookDragFast);
        } else {
            vec3.scale(this.mouseMovement, this.mouseMovement, this.mouseLookDragSlow);
        }
        if (Math.abs(this.mouseMovement[0]) < mouseMoveLowSpeedCap) this.mouseMovement[0] = 0.0;
        if (Math.abs(this.mouseMovement[1]) < mouseMoveLowSpeedCap) this.mouseMovement[1] = 0.0;

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

    public setKeyMoveSpeed(speed: number): void {
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
