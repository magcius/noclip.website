
import { mat4, vec3, quat } from 'gl-matrix';
import { InputManager } from './InputManager';

export class Camera {
    public viewMatrix: mat4 = mat4.create();
    public worldMatrix: mat4 = mat4.create();

    public worldMatrixUpdated(): void {
        mat4.invert(this.viewMatrix, this.worldMatrix);
        console.log(this.worldMatrix);
    }

    public identity(): void {
        mat4.identity(this.worldMatrix);
        mat4.identity(this.viewMatrix);
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
            console.log(camera.worldMatrix, camera.viewMatrix);
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
