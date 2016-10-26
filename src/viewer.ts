
// Workaround for not having gl-matrix typings available.
interface Window {
    mat4: any;
    vec3: any;
}

// Add our main hook.
interface Window {
    main: Viewer.Main;
}

namespace Viewer {

    class Viewport {
        canvas:HTMLCanvasElement;
        gl:WebGLRenderingContext;
    }

    export interface Texture {
        toCanvas():HTMLCanvasElement;
        title:string;
    }

    function compileShader(gl:WebGLRenderingContext, str:string, type:number) {
        var shader = gl.createShader(type);

        gl.shaderSource(shader, str);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            return null;
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
        viewport:Viewport;
        currentProgram:Program = null;

        projection:Float32Array;
        modelView:Float32Array;

        constructor(viewport:Viewport) {
            this.viewport = viewport;

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
        textures:Texture[];
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

    class Viewer {
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

                var mult = .1;
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

    export class Main {
        viewer:Viewer;
        sceneDescs: SceneDesc[];

        constructor() {
            const canvas = document.querySelector('canvas');
            this.viewer = new Viewer(canvas);
            this.viewer.start();

            this.sceneDescs = [];

            // The "plugin" part of this.
            this.sceneDescs = this.sceneDescs.concat(SM64DS.loadSceneDescs());

            this.makeUI();
        }

        loadSceneDesc(sceneDesc:SceneDesc) {
            const gl = this.viewer.sceneGraph.renderState.viewport.gl;

            sceneDesc.createScene(gl).then((result:Scene) => {
                this.viewer.setScene(result);

                const textures = document.querySelector('#textures');
                textures.innerHTML = '';
                result.textures.forEach((tex) => {
                    const canvas = tex.toCanvas();
                    canvas.title = tex.title;
                    textures.appendChild(canvas);
                });
            });
        }

        makeUI() {
            const pl = document.querySelector('#pl');

            const select = document.createElement('select');
            this.sceneDescs.forEach(function(entry) {
                const option = document.createElement('option');
                option.textContent = entry.name;
                select.appendChild(option);
            });
            pl.appendChild(select);
            const button = document.createElement('button');
            button.textContent = 'Load';
            button.addEventListener('click', () => {
                const sceneDesc = this.sceneDescs[select.selectedIndex];
                this.loadSceneDesc(sceneDesc);
            });
            pl.appendChild(button);
        }
    }

    window.addEventListener('load', function() {
        window.main = new Main();
    });
};
