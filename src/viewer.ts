
/// <reference path="decl.d.ts" />

class Viewport {
    canvas:HTMLCanvasElement;
    gl:WebGLRenderingContext;
}

function compileShader(gl:WebGLRenderingContext, str:string, type:number) {
    var shader = gl.createShader(type);

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        throw new Error();
    }

    return shader;
}

export class Program {
    _glProg:WebGLProgram;

    vert:string;
    frag:string;

    projectionLocation:WebGLUniformLocation;
    modelViewLocation:WebGLUniformLocation;

    compile(gl:WebGLRenderingContext) {
        if (this._glProg)
            return this._glProg;

        const vertShader = compileShader(gl, this.vert, gl.VERTEX_SHADER);
        const fragShader = compileShader(gl, this.frag, gl.FRAGMENT_SHADER);
        const prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        this._glProg = prog;
        this.bind(gl, prog);
        return this._glProg;
    }

    bind(gl:WebGLRenderingContext, prog:WebGLProgram) {
        this.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        this.projectionLocation = gl.getUniformLocation(prog, "u_projection");
    }
}

export class RenderState {
    gl:WebGLRenderingContext;
    viewport:Viewport;
    currentProgram:Program = null;
    time:number;

    projection:Float32Array;
    modelView:Float32Array;

    constructor(viewport:Viewport) {
        this.viewport = viewport;
        this.gl = this.viewport.gl;
        this.time = 0;

        this.projection = window.mat4.create();
        this.modelView = window.mat4.create();
    }

    checkResize() {
        const canvas = this.viewport.canvas;
        window.mat4.perspective(this.projection, Math.PI / 4, canvas.width / canvas.height, 0.2, 50000);
    }

    useProgram(prog:Program) {
        const gl = this.viewport.gl;
        this.currentProgram = prog;
        gl.useProgram(prog.compile(gl));
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, this.modelView);
    }
}

interface CameraController {
    update(camera:any, inputManager:InputManager, dt:number):void;
}

// XXX: Is there any way to do this properly and reference the interface?
type CameraControllerClass = typeof FPSCameraController | typeof OrbitCameraController;

export interface Scene {
    render(state:RenderState);
    textures:HTMLCanvasElement[];
    cameraController:CameraControllerClass;
}

class SceneGraph {
    renderState:RenderState;
    scenes:Scene[] = [];

    constructor(viewport:Viewport) {
        this.renderState = new RenderState(viewport);

        const gl = this.renderState.viewport.gl;

        // Enable EXT_frag_depth
        gl.getExtension('EXT_frag_depth');
        gl.clearColor(0.88, 0.88, 0.88, 1);
    }

    render() {
        const gl = this.renderState.viewport.gl;
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.scenes.forEach((scene) => scene.render(this.renderState));
    }

    checkResize() {
        const canvas = this.renderState.viewport.canvas;
        const gl = this.renderState.viewport.gl;
        gl.viewport(0, 0, canvas.width, canvas.height);
        this.renderState.checkResize();
    }

    setScenes(scenes) {
        this.scenes = scenes;
    }
    setCamera(matrix) {
        window.mat4.copy(this.renderState.modelView, matrix);
    }
}

// XXX: Port to a class at some point.
function elemDragger(elem:HTMLElement, callback:(dx:number, dy:number) => void):void {
    let lastX, lastY;

    function setGrabbing(v) {
        (<any> elem).grabbing = v;
        elem.style.cursor = v ? '-webkit-grabbing' : '-webkit-grab';
        elem.style.cursor = v ? 'grabbing' : 'grab';
    }

    function mousemove(e) {
        const dx = e.pageX - lastX, dy = e.pageY - lastY;
        lastX = e.pageX;
        lastY = e.pageY;
        callback(dx, dy);
    }
    function mouseup(e) {
        document.removeEventListener('mouseup', mouseup);
        document.removeEventListener('mousemove', mousemove);
        setGrabbing(false);
    }
    elem.addEventListener('mousedown', function(e) {
        lastX = e.pageX;
        lastY = e.pageY;
        document.addEventListener('mouseup', mouseup);
        document.addEventListener('mousemove', mousemove);
        setGrabbing(true);
        e.preventDefault();
    });

    setGrabbing(false);
}

class InputManager {
    toplevel:HTMLElement;
    keysDown:Map<number, boolean>;
    dx:number;
    dy:number;
    dz:number;

    constructor(toplevel) {
        this.toplevel = toplevel;

        this.keysDown = new Map<number, boolean>();
        window.addEventListener('keydown', this._onKeyDown.bind(this));
        window.addEventListener('keyup', this._onKeyUp.bind(this));
        window.addEventListener('wheel', this._onWheel.bind(this));

        this.resetMouse();

        elemDragger(this.toplevel, this._onElemDragger.bind(this));
    }

    isKeyDown(key:string) {
        return !!this.keysDown[key.charCodeAt(0)];
    }
    isKeyDownRaw(keyCode:number) {
        return !!this.keysDown[keyCode];
    }
    isDragging():boolean {
        // XXX: Should be an explicit flag.
        return (<any> this.toplevel).grabbing;
    }

    _onKeyDown(e:KeyboardEvent) {
        this.keysDown[e.keyCode] = true;
    }
    _onKeyUp(e:KeyboardEvent) {
        delete this.keysDown[e.keyCode];
    }

    _onElemDragger(dx, dy) {
        this.dx += dx;
        this.dy += dy;
    }
    _onWheel(e:WheelEvent) {
        this.dz += Math.sign(e.deltaY) * -4;
        // XXX: How can I convince Chrome to let me use wheel events without it complaining...
        e.preventDefault();
    }

    resetMouse() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
    }
}

export class FPSCameraController implements CameraController {
    _tmp:any;
    _camera:any;

    constructor() {
        this._tmp = window.mat4.create();
        this._camera = window.mat4.create();
    }

    update(outCamera, inputManager, dt):void {
        const SHIFT = 16;
        const tmp = this._tmp;
        const camera = this._camera;

        let mult = 10;
        if (inputManager.isKeyDownRaw(SHIFT))
            mult *= 5;
        mult *= (dt / 16.0);

        var amt;
        amt = 0;
        if (inputManager.isKeyDown('W'))
            amt = -mult;
        else if (inputManager.isKeyDown('S'))
            amt = mult;
        tmp[14] = amt;

        amt = 0;
        if (inputManager.isKeyDown('A'))
            amt = -mult;
        else if (inputManager.isKeyDown('D'))
            amt = mult;
        tmp[12] = amt;

        amt = 0;
        if (inputManager.isKeyDown('Q'))
            amt = -mult;
        else if (inputManager.isKeyDown('E'))
            amt = mult;
        tmp[13] = amt;

        if (inputManager.isKeyDown('B'))
            window.mat4.identity(camera);
        if (inputManager.isKeyDown('C'))
            console.log(camera);

        const cu = [camera[1], camera[5], camera[9]];
        window.vec3.normalize(cu, cu);
        window.mat4.rotate(camera, camera, -inputManager.dx / 500, cu);
        window.mat4.rotate(camera, camera, -inputManager.dy / 500, [1, 0, 0]);

        window.mat4.multiply(camera, camera, tmp);
        // XXX: Is there any way to do this without the expensive inverse?
        window.mat4.invert(outCamera, camera);
    }
}

function clamp(v:number, min:number, max:number):number {
    return Math.max(min, Math.min(v, max));
}

function clampRange(v:number, lim:number):number {
    return clamp(v, -lim, lim);
}

export class OrbitCameraController implements CameraController {
    x:number;
    y:number;
    z:number;

    xVel:number;
    yVel:number;
    zVel:number;

    constructor() {
        this.x = 0.15;
        this.y = 0.35;
        this.z = -150;
        this.xVel = 0;
        this.yVel = 0;
        this.zVel = 0;
    }

    update(camera:any, inputManager:InputManager, dt:number):void {
        // Get new velocities from inputs.
        this.xVel += inputManager.dx / 200;
        this.yVel += inputManager.dy / 200;
        this.zVel += inputManager.dz;
        if (inputManager.isKeyDown('A'))
            this.xVel += 0.05;
        if (inputManager.isKeyDown('D'))
            this.xVel -= 0.05;
        if (inputManager.isKeyDown('W'))
            this.yVel += 0.05;
        if (inputManager.isKeyDown('S'))
            this.yVel -= 0.05;

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
        window.mat4.copy(camera, [
            cosX, sinY*sinX, -cosY*sinX, 0,
            0, cosY, sinY, 0,
            sinX, -sinY*cosX, cosY*cosX, 0,
            0, 0, this.z, 1,
        ]);
    }
}

export class Viewer {
    sceneGraph:SceneGraph;
    camera:Float32Array;
    inputManager:InputManager;
    cameraController:CameraController;

    constructor(canvas:HTMLCanvasElement) {
        const gl = canvas.getContext("webgl", { alpha: false });
        const viewport = { canvas, gl };

        this.sceneGraph = new SceneGraph(viewport);
        this.camera = window.mat4.create();
        this.inputManager = new InputManager(this.sceneGraph.renderState.viewport.canvas);
        this.cameraController = null;
    }
    resetCamera() {
        window.mat4.identity(this.camera);
    }
    setScene(scene:Scene) {
        this.sceneGraph.setScenes([scene]);
        this.cameraController = new scene.cameraController();
        this.resetCamera();
    }

    start() {
        const camera = this.camera;
        const canvas = this.sceneGraph.renderState.viewport.canvas;

        let t = 0;
        const update = (nt) => {
            var dt = nt - t;
            t = nt;

            this.sceneGraph.checkResize();

            if (this.cameraController)
                this.cameraController.update(camera, this.inputManager, dt);

            this.inputManager.resetMouse();

            this.sceneGraph.setCamera(camera);
            this.sceneGraph.renderState.time += dt;
            this.sceneGraph.render();
            window.requestAnimationFrame(update);
        }
        update(0);
    }
}

export interface SceneDesc {
    name:string;
    createScene(gl:WebGLRenderingContext):PromiseLike<Scene>;
}

export interface SceneGroup {
    name:string;
    sceneDescs:SceneDesc[];
}
