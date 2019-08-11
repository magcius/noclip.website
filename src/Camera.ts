
import { mat4, vec3, vec4 } from 'gl-matrix';
import InputManager from './InputManager';
import { Frustum, AABB } from './Geometry';
import { clampRange, computeProjectionMatrixFromFrustum, computeUnitSphericalCoordinates, computeProjectionMatrixFromCuboid, texProjPerspMtx, texProjOrthoMtx, lerpAngle, lerp, MathConstants } from './MathHelpers';
import { reverseDepthForOrthographicProjectionMatrix, reverseDepthForPerspectiveProjectionMatrix } from './gfx/helpers/ReversedDepthHelpers';

export class Camera {
    // Converts to view space from world space.
    // Should be called viewFromWorldMatrix
    public viewMatrix = mat4.create();

    // The world matrix is the camera's model matrix -- that is, it converts from
    // view space to the abstract world space.
    // Should be called worldFromViewMatrix
    public worldMatrix = mat4.create();

    // Converts to (OpenGL) NDC/clip space from view space.
    // Should be called clipFromViewMatrix
    public projectionMatrix = mat4.create();

    // Combined view/projection matrix, using our new naming convention.
    public clipFromWorldMatrix = mat4.create();

    public frustum = new Frustum();
    public fovY: number;
    public orthoScaleY: number;
    public aspect: number;
    public isOrthographic: boolean = false;

    public identity(): void {
        mat4.identity(this.worldMatrix);
        mat4.identity(this.viewMatrix);
    }

    public worldMatrixUpdated(): void {
        this.frustum.updateWorldFrustum(this.worldMatrix);
        this.updateClipFromWorld();
    }

    public setPerspective(fovY: number, aspect: number, n: number, f: number = Infinity): void {
        this.fovY = fovY;
        this.aspect = aspect;
        this.isOrthographic = false;

        const nearY = Math.tan(fovY * 0.5) * n;
        const nearX = nearY * aspect;
        this.setFrustum(-nearX, nearX, -nearY, nearY, n, f);
    }

    public setOrthographic(orthoScaleY: number, aspect: number, n: number, f: number): void {
        this.orthoScaleY = orthoScaleY;
        this.aspect = aspect;

        this.isOrthographic = true;
        const nearY = orthoScaleY;
        const nearX = orthoScaleY * aspect;
        this.setFrustum(-nearX, nearX, -nearY, nearY, n, f);
    }

    public setClipPlanes(n: number, f: number = Infinity): void {
        if (this.isOrthographic) {
            // this.setOrthographic(this.orthoScaleY, this.aspect, n, f);
        } else {
            this.setPerspective(this.fovY, this.aspect, n, f);
        }
    }

    private setFrustum(left: number, right: number, bottom: number, top: number, n: number, f: number): void {
        this.frustum.setViewFrustum(left, right, bottom, top, n, f, this.isOrthographic);
        this.frustum.updateWorldFrustum(this.worldMatrix);
        if (this.isOrthographic) {
            computeProjectionMatrixFromCuboid(this.projectionMatrix, left, right, bottom, top, n, f);
            reverseDepthForOrthographicProjectionMatrix(this.projectionMatrix);
        } else {
            computeProjectionMatrixFromFrustum(this.projectionMatrix, left, right, bottom, top, n, f);
            reverseDepthForPerspectiveProjectionMatrix(this.projectionMatrix);
        }
        this.updateClipFromWorld();
    }

    public newFrame(): void {
        this.frustum.newFrame();
    }

    private updateClipFromWorld(): void {
        mat4.mul(this.clipFromWorldMatrix, this.projectionMatrix, this.viewMatrix);
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

// TODO(jstpierre): Replace, this is garbage.
export function computeModelMatrixYBillboard(out: mat4, camera: Camera): void {
    mat4.identity(out);

    // Right vector
    out[0] = camera.worldMatrix[0];
    out[4] = camera.worldMatrix[4];
    out[8] = camera.worldMatrix[8];

    // Forward vector
    out[2] = camera.worldMatrix[2];
    out[6] = camera.worldMatrix[6];
    out[10] = camera.worldMatrix[10];
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec4 = vec4.create();

/**
 * Computes a view-space depth given @param camera and @param aabb in world-space.
 * 
 * This is computed by taking the depth of the world-space depth of @param aabb.
 */
export function computeViewSpaceDepthFromWorldSpaceAABB(camera: Camera, aabb: AABB, v: vec3 = scratchVec3a): number {
    aabb.centerPoint(v);
    return computeViewSpaceDepthFromWorldSpacePoint(camera, v);
}

/**
 * Computes a view-space depth given @param camera and @param v in world-space.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 *
 * The returned value is not clamped to the near or far planes -- that is, the depth
 * value is less than zero if the camera is behind the point.
 *
 * The returned value can be passed directly to {@link GfxRenderer.setSortKeyDepth},
 * which will clamp if the value is below 0.
 */
export function computeViewSpaceDepthFromWorldSpacePoint(camera: Camera, v: vec3, v_ = scratchVec3a): number {
    vec3.transformMat4(v_, v, camera.viewMatrix);
    return -v_[2];
}

/**
 * Computes a view-space depth given @param viewMatrix and @param v in world-space.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 *
 * The returned value is not clamped to the near or far planes -- that is, the depth
 * value is less than zero if the camera is behind the point.
 *
 * The returned value can be passed directly to {@link GfxRenderer.setSortKeyDepth},
 * which will clamp if the value is below 0.
 */
export function computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(viewMatrix: mat4, v: vec3, v_ = scratchVec3a): number {
    vec3.transformMat4(v_, v, viewMatrix);
    return -v_[2];
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
 * Transforms the world-space point @param p, viewed by the camera @param Camera into
 * normalized clip space and stores the result in @param output. Note that this is normalized
 * clip space (between -1 and 1 on all three axes). Conversion into screen or viewport space
 * is not done in this function.
 */
export function computeClipSpacePointFromWorldSpacePoint(output: vec3, camera: Camera, p: vec3, v4 = scratchVec4): void {
    vec4.set(v4, p[0], p[1], p[2], 1.0);
    vec4.transformMat4(v4, v4, camera.clipFromWorldMatrix);
    const w = v4[3];
    vec3.set(output, v4[0] / w, v4[1] / w, v4[2] / w);
}

/**
 * Computes the screen-space projection @param screenSpaceProjection, that
 * a sphere in world-space coordinates with parameters @param center and @param radius
 * will take up when viewed by @param camera.
 */
export function computeScreenSpaceProjectionFromWorldSpaceSphere(screenSpaceProjection: ScreenSpaceProjection, camera: Camera, center: vec3, radius: number, v: vec3 = scratchVec3a, v4: vec4 = scratchVec4): void {
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
 * Computes the screen-space projection @param screenSpaceProjection, that
 * world-space AABB @param aabb will take up when viewed by @param camera.
 */
export function computeScreenSpaceProjectionFromWorldSpaceAABB(screenSpaceProjection: ScreenSpaceProjection, camera: Camera, aabb: AABB, v: vec3 = scratchVec3a, v4: vec4 = scratchVec4): void {
    const radius = aabb.boundingSphereRadius();

    // Compute view-space center.
    aabb.centerPoint(v);

    return computeScreenSpaceProjectionFromWorldSpaceSphere(screenSpaceProjection, camera, v, radius, v, v4);
}

export interface CameraController {
    camera: Camera;
    forceUpdate: boolean;
    cameraUpdateForced(): void;
    update(inputManager: InputManager, dt: number): boolean;
    getKeyMoveSpeed(): number;
    setKeyMoveSpeed(speed: number): void;
}

export interface CameraControllerClass {
    new(): CameraController;
}

const vec3Zero = vec3.fromValues(0, 0, 0);
const vec3Up = vec3.fromValues(0, 1, 0);
export class FPSCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;
    public useWorldUp: boolean = true;
    public onkeymovespeed: () => void = () => {};

    private keyMovement = vec3.create();
    private mouseMovement = vec3.create();

    private keyMoveSpeed = 60;
    private keyMoveShiftMult = 5;
    private keyMoveVelocityMult = 1/5;
    private keyMoveDrag = 0.8;
    private keyAngleChangeVelFast = 0.1;
    private keyAngleChangeVelSlow = 0.04;

    private mouseLookSpeed = 500;
    private mouseLookDragFast = 0;
    private mouseLookDragSlow = 0;

    public sceneKeySpeedMult = 1;

    public cameraUpdateForced(): void {
        vec3.set(this.keyMovement, 0, 0, 0);
    }

    public setKeyMoveSpeed(speed: number): void {
        this.keyMoveSpeed = speed;
    }

    public getKeyMoveSpeed(): number {
        return this.keyMoveSpeed;
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
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');

        let keyMoveMult = 1;
        if (isShiftPressed)
            keyMoveMult = this.keyMoveShiftMult;

        let keyMoveSpeedCap = this.keyMoveSpeed * keyMoveMult;
        const keyMoveVelocity = keyMoveSpeedCap * this.keyMoveVelocityMult;
    
        const keyMovement = this.keyMovement;
        const keyMoveLowSpeedCap = 0.01;

        if (inputManager.isKeyDown('KeyW') || inputManager.isKeyDown('ArrowUp')) {
            keyMovement[2] = clampRange(keyMovement[2] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyS') || inputManager.isKeyDown('ArrowDown')) {
            keyMovement[2] = clampRange(keyMovement[2] + keyMoveVelocity, keyMoveSpeedCap);
        } else {
            keyMovement[2] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[2]) < keyMoveLowSpeedCap) keyMovement[2] = 0.0;
        }

        if (inputManager.isKeyDown('KeyA') || inputManager.isKeyDown('ArrowLeft')) {
            keyMovement[0] = clampRange(keyMovement[0] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyD') || inputManager.isKeyDown('ArrowRight')) {
            keyMovement[0] = clampRange(keyMovement[0] + keyMoveVelocity, keyMoveSpeedCap);
        } else {
            keyMovement[0] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[0]) < keyMoveLowSpeedCap) keyMovement[0] = 0.0;
        }

        if (inputManager.isKeyDown('KeyQ') || inputManager.isKeyDown('PageDown') || (inputManager.isKeyDown('ControlLeft') && inputManager.isKeyDown('Space'))) {
            keyMovement[1] = clampRange(keyMovement[1] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyE') || inputManager.isKeyDown('PageUp') || inputManager.isKeyDown('Space')) {
            keyMovement[1] = clampRange(keyMovement[1] + keyMoveVelocity, keyMoveSpeedCap);
        } else {
            keyMovement[1] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[1]) < keyMoveLowSpeedCap) keyMovement[1] = 0.0;
        }

        const worldUp = scratchVec3b;
        // Instead of getting the camera up, instead use world up. Feels more natural.
        if (this.useWorldUp)
            camera.getWorldUp(worldUp);
        else
            vec3.set(worldUp, 0, 1, 0);

        if (!vec3.exactEquals(keyMovement, vec3Zero)) {
            const finalMovement = scratchVec3a;
            vec3.set(finalMovement, keyMovement[0], 0, keyMovement[2]);
            vec3.scaleAndAdd(finalMovement, finalMovement, worldUp, keyMovement[1]);
            vec3.scale(finalMovement, finalMovement, this.sceneKeySpeedMult);
            mat4.translate(camera.worldMatrix, camera.worldMatrix, finalMovement);
            updated = true;
        }

        const mouseMoveLowSpeedCap = 0.0001;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;
        const dx = inputManager.getMouseDeltaX() * (-1 / this.mouseLookSpeed) * invertXMult;
        const dy = inputManager.getMouseDeltaY() * (-1 / this.mouseLookSpeed) * invertYMult;

        const mouseMovement = this.mouseMovement;
        mouseMovement[0] += dx;
        mouseMovement[1] += dy;

        const keyAngleChangeVel = isShiftPressed ? this.keyAngleChangeVelFast : this.keyAngleChangeVelSlow;
        if (inputManager.isKeyDown('KeyJ'))
            mouseMovement[0] += keyAngleChangeVel * invertXMult;
        else if (inputManager.isKeyDown('KeyL'))
            mouseMovement[0] -= keyAngleChangeVel * invertXMult;
        if (inputManager.isKeyDown('KeyI'))
            mouseMovement[1] += keyAngleChangeVel * invertYMult;
        else if (inputManager.isKeyDown('KeyK'))
            mouseMovement[1] -= keyAngleChangeVel * invertYMult;
        if (inputManager.isKeyDown('KeyU'))
            mouseMovement[2] -= keyAngleChangeVel;
        else if (inputManager.isKeyDown('KeyO'))
            mouseMovement[2] += keyAngleChangeVel;

        if (!vec3.exactEquals(this.mouseMovement, vec3Zero)) {
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[0], worldUp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[1], [1, 0, 0]);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[2], [0, 0, 1]);
            updated = true;

            const mouseLookDrag = inputManager.isDragging() ? this.mouseLookDragFast : this.mouseLookDragSlow;
            vec3.scale(this.mouseMovement, this.mouseMovement, mouseLookDrag);

            if (Math.abs(this.mouseMovement[0]) < mouseMoveLowSpeedCap) this.mouseMovement[0] = 0.0;
            if (Math.abs(this.mouseMovement[1]) < mouseMoveLowSpeedCap) this.mouseMovement[1] = 0.0;
        }

        updated = updated || this.forceUpdate;

        if (updated) {
            this.camera.isOrthographic = false;
            mat4.invert(this.camera.viewMatrix, this.camera.worldMatrix);
            this.camera.worldMatrixUpdated();
            this.forceUpdate = false;
        }

        return updated;
    }
}

export class OrbitCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;
    public onkeymovespeed: () => void = () => {};

    public x: number = -Math.PI / 2;
    public y: number = 2;
    public z: number = -150;
    public orbitSpeed: number = -0.05;
    public xVel: number = 0;
    public yVel: number = 0;
    public zVel: number = 0;

    public translation = vec3.create();
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

    public getKeyMoveSpeed(): number {
        return 1;
    }

    public update(inputManager: InputManager, dt: number): boolean {
        if (inputManager.isKeyDownEventTriggered('KeyR')) {
            this.shouldOrbit = !this.shouldOrbit;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad5')) {
            this.shouldOrbit = false;
            this.xVel = this.yVel = 0;
        }

        if (inputManager.isKeyDownEventTriggered('KeyB')) {
            this.txVel = this.tyVel = 0;
            vec3.set(this.translation, 0, 0, 0);
        }

        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (inputManager.button === 1) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) / -5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) /  5000;
        } else if (inputManager.isDragging()) {
            this.xVel += inputManager.dx / -200 * invertXMult;
            this.yVel += inputManager.dy / -200 * invertYMult;
        } else if (shouldOrbit) {
            if (Math.abs(this.xVel) < Math.abs(this.orbitSpeed))
                this.xVel += this.orbitSpeed * 1/50;
        }
        this.zVel += inputManager.dz;
        let keyVelX = 0, keyVelY = 0;
        if (inputManager.isKeyDown('KeyA'))
            keyVelX += 0.02;
        if (inputManager.isKeyDown('KeyD'))
            keyVelX -= 0.02;
        if (inputManager.isKeyDown('KeyW'))
            keyVelY += 0.02;
        if (inputManager.isKeyDown('KeyS'))
            keyVelY -= 0.02;
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');

        if (isShiftPressed) {
            this.xVel += -keyVelX;
            this.yVel += -keyVelY;
        } else {
            this.txVel += keyVelX;
            this.tyVel += -keyVelY;
        }

        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        const updated = this.forceUpdate || this.xVel !== 0 || this.yVel !== 0 || this.zVel !== 0 || this.txVel !== 0 || this.tyVel !== 0;
        if (updated) {
            // Apply velocities.
            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.92 : 0.96;

            this.x += -this.xVel / 10;
            this.xVel *= drag;

            this.y += -this.yVel / 10;
            this.yVel *= drag;

            this.txVel *= drag;
            this.tyVel *= drag;

            this.z += this.zVel * 4;
            if (inputManager.dz === 0)
                this.zVel *= 0.85;
            if (this.z > -10) {
                this.z = -10;
                this.zVel = 0;
            }

            vec3.set(scratchVec3a, this.camera.worldMatrix[0], this.camera.worldMatrix[1], this.camera.worldMatrix[2]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.txVel);

            vec3.set(scratchVec3a, this.camera.worldMatrix[4], this.camera.worldMatrix[5], this.camera.worldMatrix[6]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.tyVel);

            const eyePos = scratchVec3a;
            computeUnitSphericalCoordinates(eyePos, this.x, this.y);
            vec3.scale(eyePos, eyePos, this.z);
            vec3.add(eyePos, eyePos, this.translation);
            this.camera.isOrthographic = false;
            mat4.lookAt(this.camera.viewMatrix, eyePos, this.translation, vec3Up);
            mat4.invert(this.camera.worldMatrix, this.camera.viewMatrix);
            this.camera.worldMatrixUpdated();
            this.forceUpdate = false;
        }

        return updated;
    }
}

function snapToMultIncr(n: number, incr: number): number {
    if (incr > 0)
        return Math.ceil(n / incr) * incr + incr;
    else
        return Math.floor(n / incr) * incr + incr;
}

export class OrthoCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;
    public onkeymovespeed: () => void = () => {};

    public x: number = -Math.PI / 2;
    public y: number = 2;
    public z: number = 200;
    public orbitSpeed: number = -0.05;
    public zVel: number = 0;
    public xTarget: number = this.x;
    public yTarget: number = this.y;

    public translation = vec3.create();
    public txVel: number = 0;
    public tyVel: number = 0;
    public shouldOrbit: boolean = false;
    private farPlane = 100000;

    constructor() {
    }

    public cameraUpdateForced(): void {
    }

    public deserialize(state: string): void {
    }

    public setKeyMoveSpeed(speed: number): void {
    }

    public getKeyMoveSpeed(): number {
        return 1;
    }

    public update(inputManager: InputManager, dt: number): boolean {
        if (inputManager.isKeyDownEventTriggered('KeyR')) {
            this.shouldOrbit = !this.shouldOrbit;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad5')) {
            this.shouldOrbit = false;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad8')) {
            // Top view.
            this.xTarget = -Math.PI * 0.5;
            this.yTarget = Math.PI - 0.001;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad4')) {
            // Left view.
            this.xTarget = 0;
            this.yTarget = Math.PI * 0.5;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad6')) {
            // Right view.
            this.xTarget = Math.PI;
            this.yTarget = Math.PI * 0.5;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad2')) {
            // Front view.
            this.xTarget = -Math.PI * 0.5;
            this.yTarget = Math.PI * 0.5;
        }

        if (inputManager.isKeyDownEventTriggered('KeyB')) {
            this.txVel = this.tyVel = 0;
            vec3.set(this.translation, 0, 0, 0);
        }

        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (inputManager.button === 1) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) / -5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) /  5000;
        } else if (inputManager.isDragging()) {
            this.xTarget += inputManager.dx / -200 * invertXMult;
            this.yTarget += inputManager.dy / -200 * invertYMult;
        } else if (shouldOrbit) {
            this.xTarget += this.orbitSpeed * 1/25;
        }
        let hasZVel = inputManager.dz !== 0;
        this.zVel += inputManager.dz * -1;

        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');
        if (!isShiftPressed) {
            if (inputManager.isKeyDown('KeyA'))
                this.txVel += 0.02;
            if (inputManager.isKeyDown('KeyD'))
                this.txVel -= 0.02;
            if (inputManager.isKeyDown('KeyW'))
                this.tyVel -= 0.02;
            if (inputManager.isKeyDown('KeyS'))
                this.tyVel += 0.02;
        } else {
            if (inputManager.isKeyDownEventTriggered('KeyA'))
                this.xTarget = snapToMultIncr(this.xTarget, +Math.PI / 4);
            if (inputManager.isKeyDownEventTriggered('KeyD'))
                this.xTarget = snapToMultIncr(this.xTarget, -Math.PI / 4);
            if (inputManager.isKeyDownEventTriggered('KeyW')) {
                this.yTarget = snapToMultIncr(this.yTarget, +Math.PI / 8);
                if (this.yTarget === Math.PI)
                    this.yTarget -= 0.001;
            }
            if (inputManager.isKeyDownEventTriggered('KeyS')) {
                this.yTarget = snapToMultIncr(this.yTarget - 0.001, -Math.PI / 8);
                if (this.yTarget === Math.PI)
                    this.yTarget += 0.001;
            }
        }

        this.xTarget = this.xTarget % MathConstants.TAU;
        this.yTarget = this.yTarget % MathConstants.TAU;

        if (inputManager.isKeyDown('KeyQ')) {
            this.zVel += 1.0;
            hasZVel = true;
        }
        if (inputManager.isKeyDown('KeyE')) {
            this.zVel -= 1.0;
            hasZVel = true;
        }

        const updated = this.forceUpdate || this.xTarget !== this.x || this.yTarget !== this.y || this.zVel !== 0 || this.txVel !== 0 || this.tyVel !== 0;
        if (updated) {
            this.x = lerpAngle(this.x, this.xTarget, 0.1);
            this.y = lerpAngle(this.y, this.yTarget, 0.1);

            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.92 : 0.96;

            this.txVel *= drag;
            this.tyVel *= drag;

            this.z += Math.max(Math.log(Math.abs(this.zVel)), 0) * 4 * Math.sign(this.zVel);
            if (!hasZVel)
                this.zVel *= 0.85;
            if (this.z < 1) {
                this.z = 1;
                this.zVel = 0;
            }

            vec3.set(scratchVec3a, this.camera.worldMatrix[0], this.camera.worldMatrix[1], this.camera.worldMatrix[2]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.txVel * -this.z);

            vec3.set(scratchVec3a, this.camera.worldMatrix[4], this.camera.worldMatrix[5], this.camera.worldMatrix[6]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.tyVel * -this.z);

            this.forceUpdate = false;
        }

        const eyePos = scratchVec3a;

        computeUnitSphericalCoordinates(eyePos, this.x, this.y);
        vec3.scale(eyePos, eyePos, -this.farPlane / 2);
        vec3.add(eyePos, eyePos, this.translation);
        mat4.lookAt(this.camera.viewMatrix, eyePos, this.translation, vec3Up);
        mat4.invert(this.camera.worldMatrix, this.camera.viewMatrix);
        this.camera.setOrthographic(this.z * 10, this.camera.aspect, 0, this.farPlane);
        this.camera.worldMatrixUpdated();

        return updated;
    }
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
    mat4.invert(camera.viewMatrix, camera.worldMatrix);
    camera.worldMatrixUpdated();
    return 4*3;
}

export function texProjCamera(dst: mat4, camera: Camera, scaleS: number, scaleT: number, transS: number, transT: number): void {
    if (camera.isOrthographic)
        texProjOrthoMtx(dst, camera.frustum.left, camera.frustum.right, camera.frustum.bottom, camera.frustum.top, scaleS, scaleT, transS, transT);
    else
        texProjPerspMtx(dst, camera.fovY, camera.aspect, scaleS, scaleT, transS, transT);
}
