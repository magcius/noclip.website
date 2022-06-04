
import { mat4, vec3, vec4, quat, ReadonlyVec3, ReadonlyMat4, ReadonlyVec4 } from 'gl-matrix';
import InputManager from './InputManager';
import { Frustum, AABB } from './Geometry';
import { clampRange, projectionMatrixForFrustum, computeUnitSphericalCoordinates, projectionMatrixForCuboid, lerpAngle, MathConstants, getMatrixAxisY, transformVec3Mat4w1, Vec3Zero, Vec3UnitY, Vec3UnitX, Vec3UnitZ, transformVec3Mat4w0, getMatrixAxisZ, getMatrixAxisX, computeEulerAngleRotationFromSRTMatrix } from './MathHelpers';
import { projectionMatrixConvertClipSpaceNearZ } from './gfx/helpers/ProjectionHelpers';
import { WebXRContext } from './WebXR';
import { assert } from './util';
import { projectionMatrixReverseDepth } from './gfx/helpers/ReversedDepthHelpers';
import { GfxClipSpaceNearZ } from './gfx/platform/GfxPlatform';
import { CameraAnimationManager, InterpolationStep, StudioPanel } from './Studio';

// TODO(jstpierre): All of the cameras and camera controllers need a pretty big overhaul.

export class Camera {
    public clipSpaceNearZ: GfxClipSpaceNearZ;

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

    // Camera's linear (aka positional) velocity. Instantaneous for the frame.
    public linearVelocity = vec3.create();

    public frustum = new Frustum();
    public fovY: number;
    public aspect: number;
    public isOrthographic: boolean = false;

    // Frustum configuration.
    public left: number;
    public right: number;
    public bottom: number;
    public top: number;
    public near: number;
    public far: number;

    private forceInfiniteFarPlane: boolean = false;

    public identity(): void {
        mat4.identity(this.worldMatrix);
        mat4.identity(this.viewMatrix);
    }

    public worldMatrixUpdated(): void {
        this.updateClipFromWorld();
    }

    public setPerspective(fovY: number, aspect: number, n: number, f: number = Infinity): void {
        this.fovY = fovY;
        this.aspect = aspect;
        this.isOrthographic = false;

        if (this.forceInfiniteFarPlane)
            f = Infinity;

        const nearY = Math.tan(fovY * 0.5) * n;
        const nearX = nearY * aspect;
        this.setFrustum(-nearX, nearX, -nearY, nearY, n, f);
    }

    public setOrthographic(orthoScaleY: number, aspect: number, n: number, f: number): void {
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

    private updateClipFromWorld(): void {
        mat4.mul(this.clipFromWorldMatrix, this.projectionMatrix, this.viewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
    }

    public updateProjectionMatrix(): void {
        if (this.isOrthographic)
            projectionMatrixForCuboid(this.projectionMatrix, this.left, this.right, this.bottom, this.top, this.near, this.far);
        else
            projectionMatrixForFrustum(this.projectionMatrix, this.left, this.right, this.bottom, this.top, this.near, this.far);
        projectionMatrixReverseDepth(this.projectionMatrix);
        projectionMatrixConvertClipSpaceNearZ(this.projectionMatrix, this.clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        this.updateClipFromWorld();
    }

    private setFrustum(left: number, right: number, bottom: number, top: number, near: number, far: number): void {
        this.left = left;
        this.right = right;
        this.bottom = bottom;
        this.top = top;
        this.near = near;
        this.far = far;
        this.updateProjectionMatrix();
    }

    public newFrame(): void {
        this.frustum.newFrame();
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

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec3f = vec3.create();
const scratchVec4 = vec4.create();
const scratchMat4 = mat4.create();
const scratchQuat = quat.create();

/**
 * Computes a view-space depth given @param viewMatrix and @param aabb in world-space.
 * 
 * This is computed by taking the depth of the center of the passed-in @param aabb.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 *
 * The returned value is not clamped to the near or far planes -- that is, the depth
 * value is less than zero if the camera is behind the point.
 *
 * The returned value can be passed directly to {@link GfxRenderInstManager.setSortKeyDepth},
 * which will clamp if the value is below 0.
 */
 export function computeViewSpaceDepthFromWorldSpaceAABB(viewMatrix: ReadonlyMat4, aabb: AABB, v: vec3 = scratchVec3a): number {
    aabb.centerPoint(v);
    return computeViewSpaceDepthFromWorldSpacePoint(viewMatrix, v);
}

/**
 * Computes a view-space depth given @param viewMatrix and @param v in world-space.
 * 
 * The convention of "view-space depth" is that 0 is near plane, +z is further away.
 *
 * The returned value is not clamped to the near or far planes -- that is, the depth
 * value is less than zero if the camera is behind the point.
 *
 * The returned value can be passed directly to {@link GfxRenderInstManager.setSortKeyDepth},
 * which will clamp if the value is below 0.
 */
 export function computeViewSpaceDepthFromWorldSpacePoint(viewMatrix: ReadonlyMat4, v: ReadonlyVec3, v_ = scratchVec3a): number {
    transformVec3Mat4w1(v_, viewMatrix, v);
    return -v_[2];
}

export function divideByW(dst: vec4, src: ReadonlyVec4): void {
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
export function computeClipSpacePointFromWorldSpacePoint(output: vec3, camera: Camera, p: ReadonlyVec3, v4 = scratchVec4): void {
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
export function computeScreenSpaceProjectionFromWorldSpaceSphere(screenSpaceProjection: ScreenSpaceProjection, camera: Camera, center: ReadonlyVec3, radius: number, v: vec3 = scratchVec3a, v4: vec4 = scratchVec4): void {
    screenSpaceProjection.reset();

    transformVec3Mat4w1(v, camera.viewMatrix, center);

    v[2] = -Math.max(Math.abs(v[2] - radius), camera.near);

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

export const enum CameraUpdateResult {
    Unchanged,
    Changed,
    ImportantChange,
}

export interface CameraController {
    camera: Camera;
    forceUpdate: boolean;
    cameraUpdateForced(): void;
    update(inputManager: InputManager, dt: number, sceneTimeScale: number): CameraUpdateResult;
    setSceneMoveSpeedMult(v: number): void;
    getKeyMoveSpeed(): number | null;
    setKeyMoveSpeed(speed: number): void;
}

export interface CameraControllerClass {
    new(): CameraController;
}

// Movement speeds have been designed for a 60fps experience.
const FPS = 1000/60;

function vec3QuantizeMajorAxis(dst: vec3, m: vec3): void {
    // Quantize to nearest world axis.
    const x = m[0], y = m[1], z = m[2], speed = vec3.length(m);
    if (Math.abs(x) > Math.abs(y) && Math.abs(x) > Math.abs(z))
        vec3.set(dst, speed * Math.sign(x), 0, 0);
    else if (Math.abs(y) > Math.abs(x) && Math.abs(y) > Math.abs(z))
        vec3.set(dst, 0, speed * Math.sign(y), 0);
    else if (Math.abs(z) > Math.abs(y) && Math.abs(z) > Math.abs(x))
        vec3.set(dst, 0, 0, speed * Math.sign(z));
}

export class FPSCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;
    public useViewUp: boolean = true;
    public onkeymovespeed: () => void = () => {};

    private keyMovement = vec3.create();
    private mouseMovement = vec3.create();

    private keyMoveSpeed = 60;
    private keyMoveShiftMult = 5;
    private keyMoveSlashMult = 0.1;
    private keyMoveVelocityMult = 1/5;
    private keyMoveDrag = 0.8;
    private keyAngleChangeVelFast = 0.1;
    private keyAngleChangeVelSlow = 0.02;
    private worldForward: vec3 | null = null;

    private mouseLookSpeed = 500;
    private mouseLookDragFast = 0;
    private mouseLookDragSlow = 0;

    public sceneMoveSpeedMult = 1;

    public cameraUpdateForced(): void {
        vec3.zero(this.keyMovement);
    }

    public setSceneMoveSpeedMult(v: number): void {
        this.sceneMoveSpeedMult = v;
    }

    public setKeyMoveSpeed(speed: number): void {
        this.keyMoveSpeed = speed;
    }

    public getKeyMoveSpeed(): number | null {
        return this.keyMoveSpeed;
    }

    public update(inputManager: InputManager, dt: number): CameraUpdateResult {
        const camera = this.camera;
        let updated = false;
        let important = false;

        if (inputManager.isKeyDown('KeyB')) {
            mat4.identity(camera.worldMatrix);
            this.cameraUpdateForced();
            updated = true;
        }

        this.keyMoveSpeed = Math.max(this.keyMoveSpeed, 1);
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');
        const isSlashPressed = inputManager.isKeyDown('IntlBackslash') || inputManager.isKeyDown('Backslash');

        let keyMoveMult = 1;
        if (isShiftPressed)
            keyMoveMult = this.keyMoveShiftMult;

        if (isSlashPressed)
            keyMoveMult = this.keyMoveSlashMult;

        if (inputManager.isKeyDownEventTriggered('Numpad4') || inputManager.isKeyDownEventTriggered('Numpad1')) {
            // Save world forward vector from current position.
            if (this.worldForward === null) {
                this.worldForward = vec3.create();
                getMatrixAxisZ(this.worldForward, camera.worldMatrix);

                if (inputManager.isKeyDownEventTriggered('Numpad4'))
                    vec3QuantizeMajorAxis(this.worldForward, this.worldForward);
            } else {
                // Toggle.
                this.worldForward = null;
            }
        }

        const keyMoveSpeedCap = this.keyMoveSpeed * keyMoveMult;
        const keyMoveVelocity = keyMoveSpeedCap * this.keyMoveVelocityMult;

        const keyMovement = this.keyMovement;
        const keyMoveLowSpeedCap = 0.1;

        if (inputManager.isKeyDown('KeyW') || inputManager.isKeyDown('ArrowUp') || (inputManager.buttons & 3) === 3) {
            keyMovement[2] = clampRange(keyMovement[2] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyS') || inputManager.isKeyDown('ArrowDown')) {
            keyMovement[2] = clampRange(keyMovement[2] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[2]) >= keyMoveLowSpeedCap) {
            keyMovement[2] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[2]) < keyMoveLowSpeedCap) { important = true; keyMovement[2] = 0.0; }
        }

        keyMovement[2] += -inputManager.getPinchDeltaDist() * keyMoveVelocity;

        if (inputManager.isKeyDown('KeyA') || inputManager.isKeyDown('ArrowLeft')) {
            keyMovement[0] = clampRange(keyMovement[0] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyD') || inputManager.isKeyDown('ArrowRight')) {
            keyMovement[0] = clampRange(keyMovement[0] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[0]) >= keyMoveLowSpeedCap) {
            keyMovement[0] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[0]) < keyMoveLowSpeedCap) { important = true; keyMovement[0] = 0.0; }
        }

        keyMovement[0] += -inputManager.getTouchDeltaX() * keyMoveVelocity;

        if (inputManager.isKeyDown('KeyQ') || inputManager.isKeyDown('PageDown') || (inputManager.isKeyDown('ControlLeft') && inputManager.isKeyDown('Space')) || inputManager.isKeyDown('KeyC')) {
            keyMovement[1] = clampRange(keyMovement[1] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyE') || inputManager.isKeyDown('PageUp') || inputManager.isKeyDown('Space')) {
            keyMovement[1] = clampRange(keyMovement[1] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[1]) >= keyMoveLowSpeedCap) {
            keyMovement[1] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[1]) < keyMoveLowSpeedCap) { important = true; keyMovement[1] = 0.0; }
        }

        keyMovement[1] += inputManager.getTouchDeltaY() * keyMoveVelocity;

        const viewUp = scratchVec3b;
        // Instead of getting the camera up, instead use view up. Feels more natural.
        if (this.useViewUp) {
            getMatrixAxisY(viewUp, camera.viewMatrix);
        } else {
            vec3.set(viewUp, 0, 1, 0);
        }

        const viewRight = scratchVec3c;
        const viewForward = scratchVec3d;

        if (this.worldForward !== null) {
            transformVec3Mat4w0(viewForward, camera.viewMatrix, this.worldForward);
            vec3.cross(viewRight, viewUp, viewForward);
        } else {
            vec3.copy(viewRight, Vec3UnitX);
            vec3.copy(viewForward, Vec3UnitZ);
        }

        if (!vec3.exactEquals(keyMovement, Vec3Zero)) {
            const finalMovement = scratchVec3a;
            vec3.zero(finalMovement);

            vec3.scaleAndAdd(finalMovement, finalMovement, viewRight, keyMovement[0]);
            vec3.scaleAndAdd(finalMovement, finalMovement, viewForward, keyMovement[2]);
            vec3.scaleAndAdd(finalMovement, finalMovement, viewUp, keyMovement[1]);

            vec3.scale(finalMovement, finalMovement, this.sceneMoveSpeedMult * (dt / FPS));

            vec3.copy(camera.linearVelocity, finalMovement);
            mat4.translate(camera.worldMatrix, camera.worldMatrix, finalMovement);
            updated = true;
        } else {
            vec3.copy(camera.linearVelocity, Vec3Zero);
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

        if (!vec3.exactEquals(this.mouseMovement, Vec3Zero)) {
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[0], viewUp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[1], Vec3UnitX);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[2], Vec3UnitZ);
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

        return important ? CameraUpdateResult.ImportantChange : updated ? CameraUpdateResult.Changed : CameraUpdateResult.Unchanged;
    }
}

export class StudioCameraController extends FPSCameraController {
    public isAnimationPlaying: boolean = false;
    private interpStep: InterpolationStep = new InterpolationStep();

    constructor(private animationManager: CameraAnimationManager, private studioPanel: StudioPanel) {
        super();
    }

    public override update(inputManager: InputManager, dt: number): CameraUpdateResult {
        let result;

        if (this.isAnimationPlaying) {
            result = this.updateAnimation(dt);
            if (result === CameraUpdateResult.Changed) {
                mat4.invert(this.camera.viewMatrix, this.camera.worldMatrix);
                this.camera.worldMatrixUpdated();
            }
            // Set result to unchanged to prevent needless savestate creation during playback.
            result = CameraUpdateResult.Unchanged;
        } else {
            result = super.update(inputManager, dt);

            this.studioPanel.drawWorldHelpers(this.camera.clipFromWorldMatrix);
        }

        return result;
    }

    public updateAnimation(dt: number): CameraUpdateResult {
        if (this.animationManager.isAnimationFinished()) {
            this.studioPanel.stopAnimation();
            return CameraUpdateResult.Unchanged;
        }

        this.animationManager.updateElapsedTime(dt);
        this.animationManager.getAnimFrame(this.interpStep);
        mat4.targetTo(this.camera.worldMatrix, this.interpStep.pos, this.interpStep.lookAtPos, Vec3UnitY);
        mat4.rotateZ(this.camera.worldMatrix, this.camera.worldMatrix, this.interpStep.bank);
        this.studioPanel.onAnimationAdvance(this.animationManager.getElapsedTimeSeconds());
        return CameraUpdateResult.Changed;
    }

    public setToPosition(setStep: InterpolationStep): void {
        mat4.targetTo(this.camera.worldMatrix, setStep.pos, setStep.lookAtPos, Vec3UnitY);
        mat4.rotateZ(this.camera.worldMatrix, this.camera.worldMatrix, setStep.bank);
        mat4.invert(this.camera.viewMatrix, this.camera.worldMatrix);
        this.camera.worldMatrixUpdated();
    }

}

export class XRCameraController {
    public cameras: Camera[] = [];

    public offset = vec3.create();

    public worldScale: number = 70; // Roughly the size of Banjo in Banjo Kazooie

    public update(webXRContext: WebXRContext): boolean {
        if (!webXRContext.xrSession)
            return false;

        const inputSources = webXRContext.xrSession.inputSources;

        const cameraMoveSpeed = this.worldScale;
        const keyMovement = scratchVec3a;
        vec3.zero(keyMovement);
        if (inputSources.length > 0) {
            for (let i = 0; i < inputSources.length; i++) {
                const gamepad = inputSources[i].gamepad;
                if (gamepad && gamepad.axes.length >= 4 && gamepad.buttons.length >= 2) {
                    keyMovement[0] = gamepad.axes[2] * cameraMoveSpeed;
                    keyMovement[1] = (gamepad.buttons[0].value - gamepad.buttons[1].value) * cameraMoveSpeed;
                    keyMovement[2] = gamepad.axes[3] * cameraMoveSpeed;
                }
            }
        }

        let updated = false;
        if (!vec3.exactEquals(keyMovement, Vec3Zero)) {            
            const viewMovementSpace = webXRContext.xrViewerSpace.getOffsetReferenceSpace(
                new XRRigidTransform(
                    new DOMPointReadOnly(keyMovement[0], 0, keyMovement[2], 1), {x:0, y:0, z:1.0, w: 1.0}));
            const pose = webXRContext.currentFrame.getPose(viewMovementSpace, webXRContext.xrLocalSpace);

            if (pose) {
                this.offset[0] += pose.transform.position.x;
                this.offset[1] += keyMovement[1];
                this.offset[2] += pose.transform.position.z;
            }

            updated = true;
        }

        // Ensure the number of XR cameras matches the number of views
        if (webXRContext.views.length !== this.cameras.length) {
            for (let i = this.cameras.length; i < webXRContext.views.length; i++)
                this.cameras.push(new Camera());
            this.cameras.length = webXRContext.views.length;
        }

        assert(this.cameras.length === webXRContext.views.length);
        for (let i = 0; i < this.cameras.length; i++) {
            const camera = this.cameras[i];
            const xrView = webXRContext.views[i];

            const cameraWorldMatrix = scratchMat4;
            mat4.copy(cameraWorldMatrix, xrView.transform.matrix);
            const cameraWorldMatrixTranslation = scratchVec3c;
            mat4.getTranslation(cameraWorldMatrixTranslation, cameraWorldMatrix);
            const originalViewTranslation = scratchVec3d;
            mat4.getTranslation(originalViewTranslation, cameraWorldMatrix);

            // Scale up view position and add offset
            const cameraScale = scratchVec3e;
            const cameraOrientation = scratchQuat;
            mat4.getScaling(cameraScale, cameraWorldMatrix);
            mat4.getRotation(cameraOrientation, cameraWorldMatrix);

            const cameraAdditionalOffset = scratchVec3f;
            vec3.copy(cameraAdditionalOffset, this.offset);
            vec3.sub(cameraAdditionalOffset, cameraAdditionalOffset, originalViewTranslation);
            vec3.scaleAndAdd(cameraWorldMatrixTranslation, cameraAdditionalOffset, cameraWorldMatrixTranslation, this.worldScale);

            mat4.fromRotationTranslationScale(cameraWorldMatrix, cameraOrientation, cameraWorldMatrixTranslation, cameraScale);
            
            camera.isOrthographic = false;

            mat4.copy(camera.worldMatrix, cameraWorldMatrix);
            mat4.invert(camera.viewMatrix, camera.worldMatrix);
            camera.worldMatrixUpdated();

            // Unpack the projection matrix to get required parameters for setting clip / frustrum etc...
            const cameraProjectionMatrix = xrView.projectionMatrix;
            mat4.copy(camera.projectionMatrix, cameraProjectionMatrix);
            const fov = 2.0*Math.atan(1.0/cameraProjectionMatrix[5]);
            const aspect = cameraProjectionMatrix[5] / cameraProjectionMatrix[0];

            // Extract camera properties
            // TODO(jstpierre): Just trust the original projection matrix
            camera.fovY = fov;
            camera.aspect = aspect;

            mat4.copy(camera.projectionMatrix, cameraProjectionMatrix);
            projectionMatrixReverseDepth(camera.projectionMatrix);

            camera.worldMatrixUpdated();

            updated = true;
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
    public zTarget: number = -150;
    public orbitSpeed: number = -0.05;
    public orbitXVel: number = 0;
    public xVel: number = 0;
    public yVel: number = 0;

    public translation = vec3.create();
    public txVel: number = 0;
    public tyVel: number = 0;

    public sceneMoveSpeedMult = 1;

    constructor(public shouldOrbit: boolean = false) {
    }

    public cameraUpdateForced(): void {
    }

    public deserialize(state: string): void {
    }

    public setSceneMoveSpeedMult(v: number): void {
        this.sceneMoveSpeedMult = v;
    }

    public setKeyMoveSpeed(speed: number): void {
    }

    public getKeyMoveSpeed(): number | null {
        return null;
    }

    public update(inputManager: InputManager, dt: number, sceneTimeScale: number): CameraUpdateResult {
        if (inputManager.isKeyDownEventTriggered('KeyR')) {
            this.shouldOrbit = !this.shouldOrbit;
        }

        if (inputManager.isKeyDownEventTriggered('Numpad5')) {
            this.shouldOrbit = false;
            this.xVel = this.yVel = 0;
        }

        if (inputManager.isKeyDownEventTriggered('KeyB')) {
            this.shouldOrbit = false;
            this.xVel = this.yVel = 0;
            this.txVel = this.tyVel = 0;
            this.xVel = this.yVel = 0;
            vec3.zero(this.translation);
        }

        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (!!(inputManager.buttons & 4)) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) / -5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) /  5000;
        } else if (inputManager.isDragging()) {
            this.xVel += inputManager.dx / -200 * invertXMult;
            this.yVel += inputManager.dy / -200 * invertYMult;
        } else if (shouldOrbit) {
            if (Math.abs(this.xVel) < Math.abs(this.orbitSpeed))
                this.orbitXVel += (this.orbitSpeed * 1/50);
        }
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

        this.orbitXVel = clampRange(this.orbitXVel, 2);
        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        let zTargetAdjAmt = inputManager.dz * 80.0;
        if (inputManager.isKeyDown('KeyQ'))
            zTargetAdjAmt -= 80.0;
        if (inputManager.isKeyDown('KeyE'))
            zTargetAdjAmt += 80.0;
        this.zTarget += zTargetAdjAmt * this.sceneMoveSpeedMult;
        if (this.zTarget > -10)
            this.zTarget = -10;
        let zTargetDelta = this.zTarget - this.z;

        const updated = this.forceUpdate || this.xVel !== 0 || this.orbitXVel !== 0 || this.yVel !== 0 || zTargetDelta !== 0 || this.txVel !== 0 || this.tyVel !== 0;
        if (updated) {
            // Apply velocities.
            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.86 : 0.94;

            this.x += -(this.xVel + (this.orbitXVel * sceneTimeScale)) / 10;
            this.xVel *= drag;
            this.orbitXVel *= drag;

            this.y += -this.yVel / 10;
            this.yVel *= drag;

            this.txVel *= drag;
            this.tyVel *= drag;

            const kSpringZ = 0.1;
            this.z += zTargetDelta * kSpringZ;

            getMatrixAxisX(scratchVec3a, this.camera.worldMatrix);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.txVel);

            getMatrixAxisY(scratchVec3a, this.camera.worldMatrix);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.tyVel);

            const eyePos = scratchVec3a;
            computeUnitSphericalCoordinates(eyePos, this.x, this.y);
            vec3.scale(eyePos, eyePos, this.z);
            vec3.add(eyePos, eyePos, this.translation);
            this.camera.isOrthographic = false;
            mat4.lookAt(this.camera.viewMatrix, eyePos, this.translation, Vec3UnitY);
            mat4.invert(this.camera.worldMatrix, this.camera.viewMatrix);
            this.camera.worldMatrixUpdated();
            this.forceUpdate = false;
        }

        // Don't bother updating the Orbit camera since we don't read it from URL.
        return CameraUpdateResult.Unchanged;
    }
}

function snapToMultIncr(n: number, incr: number): number {
    return Math.floor(n / incr) * incr + incr;
}

export class OrthoCameraController implements CameraController {
    public camera: Camera;
    public forceUpdate: boolean = false;
    public onkeymovespeed: () => void = () => {};

    public x: number = -Math.PI / 2;
    public y: number = 2;
    public z: number = -200;
    public zTarget: number = -200;
    public orbitSpeed: number = -0.05;
    public xTarget: number = this.x;
    public yTarget: number = this.y;

    public translation = vec3.create();
    public txVel: number = 0;
    public tyVel: number = 0;
    public shouldOrbit: boolean = false;
    private farPlane = 500000;
    private nearPlane = -this.farPlane;

    private sceneMoveSpeedMult = 1;

    constructor() {
    }

    public setSceneMoveSpeedMult(v: number): void {
        this.sceneMoveSpeedMult = v;
    }

    public cameraUpdateForced(): void {
    }

    public deserialize(state: string): void {
    }

    public setKeyMoveSpeed(speed: number): void {
    }

    public getKeyMoveSpeed(): number | null {
        return null;
    }

    public update(inputManager: InputManager, dt: number): CameraUpdateResult {
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
            vec3.zero(this.translation);
        }

        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (!!(inputManager.buttons & 4)) {
            this.txVel += inputManager.dx * (-10 - Math.min(-this.z, 0.01)) / -5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(-this.z, 0.01)) /  5000;
        } else if (inputManager.isDragging()) {
            this.xTarget += inputManager.dx / 200 * invertXMult;
            this.yTarget += inputManager.dy / 200 * invertYMult;
        } else if (shouldOrbit) {
            this.xTarget += this.orbitSpeed * 1/25;
        }

        let zTargetAdjAmt = inputManager.dz * 80.0;
        if (inputManager.isKeyDown('KeyQ'))
            zTargetAdjAmt -= 80.0;
        if (inputManager.isKeyDown('KeyE'))
            zTargetAdjAmt += 80.0;
        this.zTarget += zTargetAdjAmt * this.sceneMoveSpeedMult;
        if (this.zTarget > -10)
            this.zTarget = -10;
        let zTargetDelta = this.zTarget - this.z;

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

        const updated = this.forceUpdate || this.xTarget !== this.x || this.yTarget !== this.y || zTargetDelta !== 0 || this.txVel !== 0 || this.tyVel !== 0;
        if (updated) {
            this.x = lerpAngle(this.x, this.xTarget, 0.1);
            this.y = lerpAngle(this.y, this.yTarget, 0.1);

            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.92 : 0.96;

            this.txVel *= drag;
            this.tyVel *= drag;

            const kSpringZ = 0.1;
            this.z += zTargetDelta * kSpringZ;

            getMatrixAxisX(scratchVec3a, this.camera.worldMatrix);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.txVel * this.z);

            getMatrixAxisY(scratchVec3a, this.camera.worldMatrix);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.tyVel * this.z);

            this.forceUpdate = false;
        }

        const eyePos = scratchVec3a;

        computeUnitSphericalCoordinates(eyePos, this.x, this.y);
        vec3.scale(eyePos, eyePos, -this.farPlane / 2);
        vec3.add(eyePos, eyePos, this.translation);
        mat4.lookAt(this.camera.viewMatrix, eyePos, this.translation, Vec3UnitY);
        mat4.invert(this.camera.worldMatrix, this.camera.viewMatrix);
        this.camera.setOrthographic(-this.z * 10, this.camera.aspect, this.nearPlane, this.farPlane);
        this.camera.worldMatrixUpdated();

        return updated ? CameraUpdateResult.Changed : CameraUpdateResult.Unchanged;
    }
}

export function serializeMat4(view: DataView, byteOffs: number, m: mat4): number {
    view.setFloat32(byteOffs + 0x00, m[0],  true);
    view.setFloat32(byteOffs + 0x04, m[4],  true);
    view.setFloat32(byteOffs + 0x08, m[8],  true);
    view.setFloat32(byteOffs + 0x0C, m[12], true);
    view.setFloat32(byteOffs + 0x10, m[1],  true);
    view.setFloat32(byteOffs + 0x14, m[5],  true);
    view.setFloat32(byteOffs + 0x18, m[9],  true);
    view.setFloat32(byteOffs + 0x1C, m[13], true);
    view.setFloat32(byteOffs + 0x20, m[2],  true);
    view.setFloat32(byteOffs + 0x24, m[6],  true);
    view.setFloat32(byteOffs + 0x28, m[10], true);
    view.setFloat32(byteOffs + 0x2C, m[14], true);
    return 0x04*4*3;
}

export function serializeCamera(view: DataView, byteOffs: number, camera: Camera): number {
    return serializeMat4(view, byteOffs, camera.worldMatrix);
}

export function deserializeCamera(camera: Camera, view: DataView, byteOffs: number): number {
    const m = camera.worldMatrix;
    m[0]  = view.getFloat32(byteOffs + 0x00, true);
    m[4]  = view.getFloat32(byteOffs + 0x04, true);
    m[8]  = view.getFloat32(byteOffs + 0x08, true);
    m[12] = view.getFloat32(byteOffs + 0x0C, true);
    m[1]  = view.getFloat32(byteOffs + 0x10, true);
    m[5]  = view.getFloat32(byteOffs + 0x14, true);
    m[9]  = view.getFloat32(byteOffs + 0x18, true);
    m[13] = view.getFloat32(byteOffs + 0x1C, true);
    m[2]  = view.getFloat32(byteOffs + 0x20, true);
    m[6]  = view.getFloat32(byteOffs + 0x24, true);
    m[10] = view.getFloat32(byteOffs + 0x28, true);
    m[14] = view.getFloat32(byteOffs + 0x2C, true);
    m[3]  = 0;
    m[7]  = 0;
    m[11] = 0;
    m[15] = 1;
    mat4.invert(camera.viewMatrix, camera.worldMatrix);
    camera.worldMatrixUpdated();
    return 0x04*4*3;
}

function texProjCamera(dst: mat4, camera: Camera, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const projMtx = camera.projectionMatrix;

    // Avoid multiplications where we know the result will be 0.
    dst[0]  = projMtx[0]  * scaleS;
    dst[4]  = 0.0;
    dst[8]  = projMtx[8]  * scaleS + projMtx[11] * transS;
    dst[12] = projMtx[12] * scaleS + projMtx[15] * transS;

    dst[1]  = 0.0;
    dst[5]  = projMtx[5]  * scaleT;
    dst[9]  = projMtx[9]  * scaleT + projMtx[11] * transT;
    dst[13] = projMtx[12] * scaleT + projMtx[15] * transT;

    // Move from third column.
    dst[2]  = 0.0;
    dst[6]  = 0.0;
    dst[10] = projMtx[11];
    dst[14] = projMtx[15];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3]  = 9999.0;
    dst[7]  = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function texProjCameraSceneTex(dst: mat4, camera: Camera, flipYScale: number): void {
    // Map from -1 to 1 to 0 to 1.
    let scaleS = 0.5, scaleT = -0.5 * flipYScale, transS = 0.5, transT = 0.5;
    texProjCamera(dst, camera, scaleS, scaleT, transS, transT);
}
