
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

    projection:Float32Array;
    modelView:Float32Array;

    constructor(viewport:Viewport) {
        this.viewport = viewport;
        this.gl = this.viewport.gl;

        this.projection = window.mat4.create();
        window.mat4.perspective(this.projection, Math.PI / 4, viewport.canvas.width / viewport.canvas.height, 0.2, 50000);
        this.modelView = window.mat4.create();
    }

    useProgram(prog:Program) {
        const gl = this.viewport.gl;
        this.currentProgram = prog;
        gl.useProgram(prog.compile(gl));
        gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
        gl.uniformMatrix4fv(prog.modelViewLocation, false, this.modelView);
    }
}

export interface Scene {
    render(state:RenderState);
    textures:HTMLCanvasElement[];
}

class SceneGraph {
    renderState:RenderState;
    scenes:Scene[] = [];

    constructor(viewport:Viewport) {
        this.renderState = new RenderState(viewport);

        const gl = this.renderState.viewport.gl;
        gl.viewport(0, 0, viewport.canvas.width, viewport.canvas.height);
        gl.clearColor(200/255, 50/255, 153/255, 1);
    }

    render() {
        const gl = this.renderState.viewport.gl;
        gl.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.scenes.forEach((scene) => scene.render(this.renderState));
    }

    setScenes(scenes) {
        this.scenes = scenes;
        this.render();
    }
    setCamera(matrix) {
        window.mat4.invert(this.renderState.modelView, matrix);
        this.render();
    }
}

export class Viewer {
    sceneGraph: SceneGraph;
    camera: Float32Array;

    constructor(canvas:HTMLCanvasElement) {
        const gl = canvas.getContext("webgl", { alpha: false });
        const viewport = { canvas, gl };

        this.sceneGraph = new SceneGraph(viewport);
        this.camera = window.mat4.create();
    }
    resetCamera() {
        window.mat4.identity(this.camera);
    }
    setScene(scene:Scene) {
        this.sceneGraph.setScenes([scene]);
        this.resetCamera();
    }

    start() {
        const camera = this.camera;
        const canvas = this.sceneGraph.renderState.viewport.canvas;

        const keysDown = {};
        const SHIFT = 16;

        function isKeyDown(key) {
            return !!keysDown[key.charCodeAt(0)];
        }

        window.addEventListener('keydown', function(e) {
            keysDown[e.keyCode] = true;
        });
        window.addEventListener('keyup', function(e) {
            delete keysDown[e.keyCode];
        });

        function elemDragger(elem, callback) {
            var lx, ly;

            function mousemove(e) {
                var dx = e.pageX - lx, dy = e.pageY - ly;
                lx = e.pageX; ly = e.pageY;
                callback(dx, dy);
            }
            function mouseup(e) {
                document.removeEventListener('mouseup', mouseup);
                document.removeEventListener('mousemove', mousemove);
                document.body.classList.remove('grabbing');
            }
            elem.addEventListener('mousedown', function(e) {
                lx = e.pageX; ly = e.pageY;
                document.addEventListener('mouseup', mouseup);
                document.addEventListener('mousemove', mousemove);
                document.body.classList.add('grabbing');
                e.preventDefault();
            });
        }

        elemDragger(canvas, function(dx, dy) {
            var cu = [camera[1], camera[5], camera[9]];
            window.vec3.normalize(cu, cu);
            window.mat4.rotate(camera, camera, -dx / 500, cu);
            window.mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
        });

        var tmp = window.mat4.create();
        var t = 0;
        const update = (nt) => {
            var dt = nt - t;
            t = nt;

            var mult = 10;
            if (keysDown[SHIFT])
                mult *= 5;
            mult *= (dt / 16.0);

            var amt;
            amt = 0;
            if (isKeyDown('W'))
                amt = -mult;
            else if (isKeyDown('S'))
                amt = mult;
            tmp[14] = amt;

            amt = 0;
            if (isKeyDown('A'))
                amt = -mult;
            else if (isKeyDown('D'))
                amt = mult;
            tmp[12] = amt;

            amt = 0;
            if (isKeyDown('Q'))
                amt = -mult;
            else if (isKeyDown('E'))
                amt = mult;
            tmp[13] = amt;

            if (isKeyDown('B'))
                window.mat4.identity(camera);
            if (isKeyDown('C'))
                console.log(camera);

            window.mat4.multiply(camera, camera, tmp);

            this.sceneGraph.setCamera(camera);
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
