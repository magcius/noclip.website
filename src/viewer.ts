
// tslint:disable:no-console

import { Progressable } from './progress';
import { RenderState, RenderFlags, Viewport, RenderPass } from './render';

import { mat4, vec3 } from 'gl-matrix';

interface CameraController {
    update(camera: mat4, inputManager: InputManager, dt: number): void;
}

// XXX: Is there any way to do this properly and reference the interface?
type CameraControllerClass = typeof FPSCameraController | typeof OrbitCameraController;

export interface Scene {
    cameraController: CameraControllerClass;
    renderPasses: RenderPass[];
    textures: HTMLCanvasElement[];
    render(state: RenderState): void;
    destroy(gl: WebGL2RenderingContext): void;
}

class SceneGraph {
    public renderState: RenderState;
    public scene: Scene = null;

    constructor(viewport: Viewport) {
        this.renderState = new RenderState(viewport);
        this.reset();
    }

    public reset() {
        const gl = this.renderState.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.clearColor(0.88, 0.88, 0.88, 1);
        this.renderState.setClipPlanes(0.2, 50000);
    }

    public render() {
        const gl = this.renderState.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.renderState.useFlags(RenderFlags.default);

        if (!this.scene)
            return;

        const state = this.renderState;
        const scene = this.scene;
        for (let i = 0; i < RenderPass.COUNT; i++) {
            state.currentPass = i;
            if (scene.renderPasses.includes(state.currentPass))
                scene.render(state);
        }
    }

    public checkResize() {
        this.renderState.checkResize();
    }

    public setScene(scene: Scene) {
        if (this.scene)
            this.scene.destroy(this.renderState.gl);
        this.scene = scene;
    }
    public setCamera(matrix: mat4) {
        mat4.copy(this.renderState.modelView, matrix);
    }
}

// XXX: Port to a class at some point.
function elemDragger(elem: HTMLElement, callback: (dx: number, dy: number) => void): void {
    let lastX: number;
    let lastY: number;

    function setGrabbing(v: boolean) {
        (<any> elem).grabbing = v;
        elem.style.cursor = v ? '-webkit-grabbing' : '-webkit-grab';
        elem.style.cursor = v ? 'grabbing' : 'grab';
    }

    function mousemove(e: MouseEvent) {
        const dx = e.pageX - lastX;
        const dy = e.pageY - lastY;
        lastX = e.pageX;
        lastY = e.pageY;
        callback(dx, dy);
    }
    function mouseup(e: MouseEvent) {
        document.removeEventListener('mouseup', mouseup);
        document.removeEventListener('mousemove', mousemove);
        setGrabbing(false);
    }
    elem.addEventListener('mousedown', (e) => {
        lastX = e.pageX;
        lastY = e.pageY;
        document.addEventListener('mouseup', mouseup);
        document.addEventListener('mousemove', mousemove);
        setGrabbing(true);
        // XXX(jstpierre): Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        elem.focus();
        e.preventDefault();
    });

    setGrabbing(false);
}

class InputManager {
    public toplevel: HTMLElement;
    public keysDown: Map<number, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;

    constructor(toplevel: HTMLElement) {
        this.toplevel = toplevel;

        this.keysDown = new Map<number, boolean>();
        window.addEventListener('keydown', this._onKeyDown.bind(this));
        window.addEventListener('keyup', this._onKeyUp.bind(this));
        window.addEventListener('wheel', this._onWheel.bind(this), { passive: true });

        this.resetMouse();

        elemDragger(this.toplevel, this._onElemDragger.bind(this));
    }

    public isKeyDown(key: string) {
        return this.keysDown.get(key.charCodeAt(0));
    }
    public isKeyDownRaw(keyCode: number) {
        return this.keysDown.get(keyCode);
    }
    public isDragging(): boolean {
        // XXX: Should be an explicit flag.
        return (<any> this.toplevel).grabbing;
    }
    public resetMouse() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
    }

    private _onKeyDown(e: KeyboardEvent) {
        this.keysDown.set(e.keyCode, true);
    }
    private _onKeyUp(e: KeyboardEvent) {
        this.keysDown.delete(e.keyCode);
    }

    private _onElemDragger(dx: number, dy: number) {
        this.dx += dx;
        this.dy += dy;
    }
    private _onWheel(e: WheelEvent) {
        this.dz += Math.sign(e.deltaY) * -4;
    }
}

export class FPSCameraController implements CameraController {
    private tmp: mat4;
    private camera: mat4;
    private speed: number;

    constructor() {
        this.tmp = mat4.create();
        this.camera = mat4.create();
        this.speed = 10;
    }

    public update(outCamera: mat4, inputManager: InputManager, dt: number): void {
        const SHIFT = 16;
        const tmp = this.tmp;
        const camera = this.camera;

        this.speed += inputManager.dz;
        this.speed = Math.max(this.speed, 1);

        let mult = this.speed;
        if (inputManager.isKeyDownRaw(SHIFT))
            mult *= 5;
        mult *= (dt / 16.0);

        let amt;
        amt = 0;
        if (inputManager.isKeyDown('W')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('S')) {
            amt = mult;
        }
        tmp[14] = amt;

        amt = 0;
        if (inputManager.isKeyDown('A')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('D')) {
            amt = mult;
        }
        tmp[12] = amt;

        amt = 0;
        if (inputManager.isKeyDown('Q')) {
            amt = -mult;
        } else if (inputManager.isKeyDown('E')) {
            amt = mult;
        }
        tmp[13] = amt;

        if (inputManager.isKeyDown('B')) {
            mat4.identity(camera);
        }
        if (inputManager.isKeyDown('C')) {
            console.log(camera);
        }

        const cu = vec3.fromValues(camera[1], camera[5], camera[9]);
        vec3.normalize(cu, cu);
        mat4.rotate(camera, camera, -inputManager.dx / 500, cu);
        mat4.rotate(camera, camera, -inputManager.dy / 500, [1, 0, 0]);

        mat4.multiply(camera, camera, tmp);
        // XXX: Is there any way to do this without the expensive inverse?
        mat4.invert(outCamera, camera);
    }
}

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

function clampRange(v: number, lim: number): number {
    return clamp(v, -lim, lim);
}

export class OrbitCameraController implements CameraController {
    public x: number;
    public y: number;
    public z: number;

    public xVel: number;
    public yVel: number;
    public zVel: number;

    constructor() {
        this.x = 0.15;
        this.y = 0.35;
        this.z = -150;
        this.xVel = 0;
        this.yVel = 0;
        this.zVel = 0;
    }

    public update(camera: mat4, inputManager: InputManager, dt: number): void {
        // Get new velocities from inputs.
        this.xVel += inputManager.dx / 200;
        this.yVel += inputManager.dy / 200;
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

        // Apply velocities.
        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);
        const drag = inputManager.isDragging() ? 0.92 : 0.96;

        this.x += this.xVel / 10;
        this.xVel *= drag;

        this.y += this.yVel / 10;
        this.yVel *= drag;
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

        // Calculate new camera from new x/y/z.
        const sinX = Math.sin(this.x);
        const cosX = Math.cos(this.x);
        const sinY = Math.sin(this.y);
        const cosY = Math.cos(this.y);
        mat4.copy(camera, mat4.fromValues(
            cosX, sinY * sinX, -cosY * sinX, 0,
            0, cosY, sinY, 0,
            sinX, -sinY * cosX, cosY * cosX, 0,
            0, 0, this.z, 1,
        ));
    }
}

export class Viewer {
    public sceneGraph: SceneGraph;
    public camera: mat4;
    public inputManager: InputManager;
    public cameraController: CameraController;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2", { alpha: false });
        const viewport = { canvas, gl };

        this.sceneGraph = new SceneGraph(viewport);
        this.camera = mat4.create();
        this.inputManager = new InputManager(this.sceneGraph.renderState.viewport.canvas);
        this.cameraController = null;
    }
    public resetCamera() {
        mat4.identity(this.camera);
    }
    public setScene(scene: Scene) {
        this.sceneGraph.reset();
        if (scene) {
            this.sceneGraph.setScene(scene);
            this.cameraController = new scene.cameraController();
        } else {
            this.sceneGraph.setScene(null);
        }
        this.resetCamera();
    }

    public start() {
        const camera = this.camera;
        const canvas = this.sceneGraph.renderState.viewport.canvas;

        let t = 0;
        const update = (nt: number) => {
            const dt = nt - t;
            t = nt;

            this.sceneGraph.checkResize();

            if (this.cameraController) {
                this.cameraController.update(camera, this.inputManager, dt);
            }

            this.inputManager.resetMouse();

            this.sceneGraph.setCamera(camera);
            this.sceneGraph.renderState.time += dt;
            this.sceneGraph.render();
            window.requestAnimationFrame(update);
        };
        update(0);
    }
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(gl: WebGL2RenderingContext): Progressable<Scene>;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: SceneDesc[];
}
