var __values = (this && this.__values) || function (o) {
    var m = typeof Symbol === "function" && o[Symbol.iterator], i = 0;
    if (m) return m.call(o);
    return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
};
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
// Nintendo DS LZ77 format.
System.register("lz77", [], function (exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    // LZ10:
    // Header (4 bytes):
    //   Magic: "\x10" (1 byte)
    //   Uncompressed size (3 bytes, little endian)
    // Data:
    //   Flags (1 byte)
    //   For each bit in the flags byte, from MSB to LSB:
    //     If flag is 1:
    //       LZ77 (2 bytes, big endian):
    //         Length: bits 0-3
    //         Offset: bits 4-15
    //         Copy Length+3 bytes from Offset back in the output buffer.
    //     If flag is 0:
    //       Literal: copy one byte from src to dest.
    function decompressLZ10(srcView) {
        var uncompressedSize = srcView.getUint32(0x00, true) >> 8;
        var dstBuffer = new Uint8Array(uncompressedSize);
        var srcOffs = 0x04;
        var dstOffs = 0x00;
        while (true) {
            var commandByte = srcView.getUint8(srcOffs++);
            var i = 8;
            while (i--) {
                if (commandByte & (1 << i)) {
                    var tmp = srcView.getUint16(srcOffs, false);
                    srcOffs += 2;
                    var windowOffset = (tmp & 0x0FFF) + 1;
                    var windowLength = (tmp >> 12) + 3;
                    var copyOffs = dstOffs - windowOffset;
                    uncompressedSize -= windowLength;
                    while (windowLength--)
                        dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
                }
                else {
                    // Literal.
                    uncompressedSize--;
                    dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                }
                if (uncompressedSize <= 0)
                    return dstBuffer.buffer;
            }
        }
    }
    exports_1("decompressLZ10", decompressLZ10);
    // LZ11:
    // Header (4 bytes):
    //   Magic: "\x11" (1 byte)
    //   Uncompressed size (3 bytes, little endian)
    // Data:
    //   Flags (1 byte)
    //   For each bit in the flags byte, from MSB to LSB:
    //     If flag is 1:
    //       Fancy LZ77. See below for more details. Flag switches on 4-7 of newly read byte.
    //     If flag is 0:
    //       Literal: copy one byte from src to dest.
    function decompressLZ11(srcView) {
        var uncompressedSize = srcView.getUint32(0x00, true) >> 8;
        var dstBuffer = new Uint8Array(uncompressedSize);
        var srcOffs = 0x04;
        var dstOffs = 0x00;
        while (true) {
            var commandByte = srcView.getUint8(srcOffs++);
            var i = 8;
            while (i--) {
                if (commandByte & (1 << i)) {
                    var tmp = srcView.getUint32(srcOffs, false);
                    var windowOffset = void 0;
                    var windowLength = void 0;
                    var indicator = (tmp >>> 28);
                    if (indicator > 1) {
                        // Two bytes. AB CD xx xx
                        // Length: A + 1
                        // Offset: BCD + 1
                        windowLength = indicator + 1;
                        windowOffset = ((tmp >>> 16) & 0x0FFF) + 1;
                    }
                    else if (indicator === 0) {
                        // Three bytes: AB CD EF xx
                        // Length: BC + 0x11
                        // Offset: DEF + 1
                        windowLength = (tmp >>> 20) + 0x11;
                        windowOffset = ((tmp >>> 8) & 0x0FFF) + 1;
                        srcOffs += 3;
                    }
                    else if (indicator === 1) {
                        // Four bytes. AB CD EF GH
                        // Length: BCDE + 0x11
                        // Offset: FGH + 1
                        windowLength = ((tmp >>> 12) & 0xFFFF) + 0x111;
                        windowOffset = (tmp & 0x0FFF) + 1;
                        srcOffs += 4;
                    }
                    var copyOffs = dstOffs - windowOffset;
                    uncompressedSize -= windowLength;
                    while (windowLength--)
                        dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
                }
                else {
                    // Literal.
                    uncompressedSize--;
                    dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                }
                if (uncompressedSize <= 0)
                    return dstBuffer.buffer;
            }
        }
    }
    exports_1("decompressLZ11", decompressLZ11);
    function decompress(srcBuffer) {
        var srcView = new DataView(srcBuffer);
        var magic = srcView.getUint8(0x00);
        if (magic === 0x10)
            return decompressLZ10(srcView);
        else if (magic === 0x11)
            return decompressLZ11(srcView);
        else
            throw new Error("Not Nintendo LZ77");
    }
    exports_1("decompress", decompress);
    return {
        setters: [],
        execute: function () {
            // Nintendo DS LZ77 format.
        }
    };
});
// tslint:disable:no-console
System.register("viewer", ["gl-matrix"], function (exports_2, context_2) {
    "use strict";
    var __moduleName = context_2 && context_2.id;
    function compileShader(gl, str, type) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, str);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(str);
            console.error(gl.getShaderInfoLog(shader));
            throw new Error();
        }
        return shader;
    }
    // XXX: Port to a class at some point.
    function elemDragger(elem, callback) {
        var lastX;
        var lastY;
        function setGrabbing(v) {
            elem.grabbing = v;
            elem.style.cursor = v ? '-webkit-grabbing' : '-webkit-grab';
            elem.style.cursor = v ? 'grabbing' : 'grab';
        }
        function mousemove(e) {
            var dx = e.pageX - lastX;
            var dy = e.pageY - lastY;
            lastX = e.pageX;
            lastY = e.pageY;
            callback(dx, dy);
        }
        function mouseup(e) {
            document.removeEventListener('mouseup', mouseup);
            document.removeEventListener('mousemove', mousemove);
            setGrabbing(false);
        }
        elem.addEventListener('mousedown', function (e) {
            lastX = e.pageX;
            lastY = e.pageY;
            document.addEventListener('mouseup', mouseup);
            document.addEventListener('mousemove', mousemove);
            setGrabbing(true);
            e.preventDefault();
        });
        setGrabbing(false);
    }
    function clamp(v, min, max) {
        return Math.max(min, Math.min(v, max));
    }
    function clampRange(v, lim) {
        return clamp(v, -lim, lim);
    }
    var gl_matrix_1, Viewport, Program, RenderState, SceneGraph, InputManager, FPSCameraController, OrbitCameraController, Viewer;
    return {
        setters: [
            function (gl_matrix_1_1) {
                gl_matrix_1 = gl_matrix_1_1;
            }
        ],
        execute: function () {
            // tslint:disable:no-console
            Viewport = /** @class */ (function () {
                function Viewport() {
                }
                return Viewport;
            }());
            Program = /** @class */ (function () {
                function Program() {
                }
                Program.prototype.compile = function (gl) {
                    if (this.glProg)
                        return this.glProg;
                    var vertShader = compileShader(gl, this.vert, gl.VERTEX_SHADER);
                    var fragShader = compileShader(gl, this.frag, gl.FRAGMENT_SHADER);
                    var prog = gl.createProgram();
                    gl.attachShader(prog, vertShader);
                    gl.attachShader(prog, fragShader);
                    gl.linkProgram(prog);
                    this.glProg = prog;
                    this.bind(gl, prog);
                    return this.glProg;
                };
                Program.prototype.bind = function (gl, prog) {
                    this.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
                    this.projectionLocation = gl.getUniformLocation(prog, "u_projection");
                };
                return Program;
            }());
            exports_2("Program", Program);
            RenderState = /** @class */ (function () {
                function RenderState(viewport) {
                    this.currentProgram = null;
                    this.viewport = viewport;
                    this.gl = this.viewport.gl;
                    this.time = 0;
                    this.fov = Math.PI / 4;
                    this.projection = gl_matrix_1.mat4.create();
                    this.modelView = gl_matrix_1.mat4.create();
                }
                RenderState.prototype.checkResize = function () {
                    var canvas = this.viewport.canvas;
                    gl_matrix_1.mat4.perspective(this.projection, this.fov, canvas.width / canvas.height, 0.2, 50000);
                };
                RenderState.prototype.useProgram = function (prog) {
                    var gl = this.viewport.gl;
                    this.currentProgram = prog;
                    gl.useProgram(prog.compile(gl));
                    gl.uniformMatrix4fv(prog.projectionLocation, false, this.projection);
                    gl.uniformMatrix4fv(prog.modelViewLocation, false, this.modelView);
                };
                return RenderState;
            }());
            exports_2("RenderState", RenderState);
            SceneGraph = /** @class */ (function () {
                function SceneGraph(viewport) {
                    this.scenes = [];
                    this.renderState = new RenderState(viewport);
                    var gl = this.renderState.viewport.gl;
                    // Enable EXT_frag_depth
                    gl.getExtension('EXT_frag_depth');
                    gl.getExtension('OES_standard_derivatives');
                    gl.clearColor(0.88, 0.88, 0.88, 1);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                }
                SceneGraph.prototype.render = function () {
                    var _this = this;
                    var gl = this.renderState.viewport.gl;
                    gl.depthMask(true);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    this.scenes.forEach(function (scene) { return scene.render(_this.renderState); });
                };
                SceneGraph.prototype.checkResize = function () {
                    var canvas = this.renderState.viewport.canvas;
                    var gl = this.renderState.viewport.gl;
                    gl.viewport(0, 0, canvas.width, canvas.height);
                    this.renderState.checkResize();
                };
                SceneGraph.prototype.setScenes = function (scenes) {
                    this.scenes = scenes;
                };
                SceneGraph.prototype.setCamera = function (matrix) {
                    gl_matrix_1.mat4.copy(this.renderState.modelView, matrix);
                };
                return SceneGraph;
            }());
            InputManager = /** @class */ (function () {
                function InputManager(toplevel) {
                    this.toplevel = toplevel;
                    this.keysDown = new Map();
                    window.addEventListener('keydown', this._onKeyDown.bind(this));
                    window.addEventListener('keyup', this._onKeyUp.bind(this));
                    window.addEventListener('wheel', this._onWheel.bind(this));
                    this.resetMouse();
                    elemDragger(this.toplevel, this._onElemDragger.bind(this));
                }
                InputManager.prototype.isKeyDown = function (key) {
                    return !!this.keysDown[key.charCodeAt(0)];
                };
                InputManager.prototype.isKeyDownRaw = function (keyCode) {
                    return !!this.keysDown[keyCode];
                };
                InputManager.prototype.isDragging = function () {
                    // XXX: Should be an explicit flag.
                    return this.toplevel.grabbing;
                };
                InputManager.prototype.resetMouse = function () {
                    this.dx = 0;
                    this.dy = 0;
                    this.dz = 0;
                };
                InputManager.prototype._onKeyDown = function (e) {
                    this.keysDown[e.keyCode] = true;
                };
                InputManager.prototype._onKeyUp = function (e) {
                    delete this.keysDown[e.keyCode];
                };
                InputManager.prototype._onElemDragger = function (dx, dy) {
                    this.dx += dx;
                    this.dy += dy;
                };
                InputManager.prototype._onWheel = function (e) {
                    this.dz += Math.sign(e.deltaY) * -4;
                    // XXX: How can I convince Chrome to let me use wheel events without it complaining...
                    e.preventDefault();
                };
                return InputManager;
            }());
            FPSCameraController = /** @class */ (function () {
                function FPSCameraController() {
                    this.tmp = gl_matrix_1.mat4.create();
                    this.camera = gl_matrix_1.mat4.create();
                }
                FPSCameraController.prototype.update = function (outCamera, inputManager, dt) {
                    var SHIFT = 16;
                    var tmp = this.tmp;
                    var camera = this.camera;
                    var mult = 10;
                    if (inputManager.isKeyDownRaw(SHIFT))
                        mult *= 5;
                    mult *= (dt / 16.0);
                    var amt;
                    amt = 0;
                    if (inputManager.isKeyDown('W')) {
                        amt = -mult;
                    }
                    else if (inputManager.isKeyDown('S')) {
                        amt = mult;
                    }
                    tmp[14] = amt;
                    amt = 0;
                    if (inputManager.isKeyDown('A')) {
                        amt = -mult;
                    }
                    else if (inputManager.isKeyDown('D')) {
                        amt = mult;
                    }
                    tmp[12] = amt;
                    amt = 0;
                    if (inputManager.isKeyDown('Q')) {
                        amt = -mult;
                    }
                    else if (inputManager.isKeyDown('E')) {
                        amt = mult;
                    }
                    tmp[13] = amt;
                    if (inputManager.isKeyDown('B')) {
                        gl_matrix_1.mat4.identity(camera);
                    }
                    if (inputManager.isKeyDown('C')) {
                        console.log(camera);
                    }
                    var cu = gl_matrix_1.vec3.fromValues(camera[1], camera[5], camera[9]);
                    gl_matrix_1.vec3.normalize(cu, cu);
                    gl_matrix_1.mat4.rotate(camera, camera, -inputManager.dx / 500, cu);
                    gl_matrix_1.mat4.rotate(camera, camera, -inputManager.dy / 500, [1, 0, 0]);
                    gl_matrix_1.mat4.multiply(camera, camera, tmp);
                    // XXX: Is there any way to do this without the expensive inverse?
                    gl_matrix_1.mat4.invert(outCamera, camera);
                };
                return FPSCameraController;
            }());
            exports_2("FPSCameraController", FPSCameraController);
            OrbitCameraController = /** @class */ (function () {
                function OrbitCameraController() {
                    this.x = 0.15;
                    this.y = 0.35;
                    this.z = -150;
                    this.xVel = 0;
                    this.yVel = 0;
                    this.zVel = 0;
                }
                OrbitCameraController.prototype.update = function (camera, inputManager, dt) {
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
                    var drag = inputManager.isDragging() ? 0.92 : 0.96;
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
                    var sinX = Math.sin(this.x);
                    var cosX = Math.cos(this.x);
                    var sinY = Math.sin(this.y);
                    var cosY = Math.cos(this.y);
                    gl_matrix_1.mat4.copy(camera, gl_matrix_1.mat4.fromValues(cosX, sinY * sinX, -cosY * sinX, 0, 0, cosY, sinY, 0, sinX, -sinY * cosX, cosY * cosX, 0, 0, 0, this.z, 1));
                };
                return OrbitCameraController;
            }());
            exports_2("OrbitCameraController", OrbitCameraController);
            Viewer = /** @class */ (function () {
                function Viewer(canvas) {
                    var gl = canvas.getContext("webgl", { alpha: false });
                    var viewport = { canvas: canvas, gl: gl };
                    this.sceneGraph = new SceneGraph(viewport);
                    this.camera = gl_matrix_1.mat4.create();
                    this.inputManager = new InputManager(this.sceneGraph.renderState.viewport.canvas);
                    this.cameraController = null;
                }
                Viewer.prototype.resetCamera = function () {
                    gl_matrix_1.mat4.identity(this.camera);
                };
                Viewer.prototype.setScene = function (scene) {
                    this.sceneGraph.setScenes([scene]);
                    this.cameraController = new scene.cameraController();
                    this.resetCamera();
                };
                Viewer.prototype.start = function () {
                    var _this = this;
                    var camera = this.camera;
                    var canvas = this.sceneGraph.renderState.viewport.canvas;
                    var t = 0;
                    var update = function (nt) {
                        var dt = nt - t;
                        t = nt;
                        _this.sceneGraph.checkResize();
                        if (_this.cameraController) {
                            _this.cameraController.update(camera, _this.inputManager, dt);
                        }
                        _this.inputManager.resetMouse();
                        _this.sceneGraph.setCamera(camera);
                        _this.sceneGraph.renderState.time += dt;
                        _this.sceneGraph.render();
                        window.requestAnimationFrame(update);
                    };
                    update(0);
                };
                return Viewer;
            }());
            exports_2("Viewer", Viewer);
        }
    };
});
// GX constants. Mostly taken from libogc.
System.register("j3d/gx", [], function (exports_3, context_3) {
    "use strict";
    var __moduleName = context_3 && context_3.id;
    var PrimitiveType, VertexAttribute, CompCnt, CompType, CompareType, AlphaOp, CullMode, BlendMode, TevOp, TevBias, TevScale, CombineColorInput, CombineAlphaInput, KonstColorSel, KonstAlphaSel, TexFormat, TexPalette, TexFilter, WrapMode, ColorSrc, TexGenSrc, TexGenType, TexGenMatrix;
    return {
        setters: [],
        execute: function () {
            // GX constants. Mostly taken from libogc.
            (function (PrimitiveType) {
                PrimitiveType[PrimitiveType["TRIANGLESTRIP"] = 152] = "TRIANGLESTRIP";
                PrimitiveType[PrimitiveType["TRIANGLEFAN"] = 160] = "TRIANGLEFAN";
            })(PrimitiveType || (PrimitiveType = {}));
            exports_3("PrimitiveType", PrimitiveType);
            (function (VertexAttribute) {
                VertexAttribute[VertexAttribute["PTMTXIDX"] = 0] = "PTMTXIDX";
                VertexAttribute[VertexAttribute["TEX0MTXIDX"] = 1] = "TEX0MTXIDX";
                VertexAttribute[VertexAttribute["TEX1MTXIDX"] = 2] = "TEX1MTXIDX";
                VertexAttribute[VertexAttribute["TEX2MTXIDX"] = 3] = "TEX2MTXIDX";
                VertexAttribute[VertexAttribute["TEX3MTXIDX"] = 4] = "TEX3MTXIDX";
                VertexAttribute[VertexAttribute["TEX4MTXIDX"] = 5] = "TEX4MTXIDX";
                VertexAttribute[VertexAttribute["TEX5MTXIDX"] = 6] = "TEX5MTXIDX";
                VertexAttribute[VertexAttribute["TEX6MTXIDX"] = 7] = "TEX6MTXIDX";
                VertexAttribute[VertexAttribute["TEX7MTXIDX"] = 8] = "TEX7MTXIDX";
                VertexAttribute[VertexAttribute["POS"] = 9] = "POS";
                VertexAttribute[VertexAttribute["NRM"] = 10] = "NRM";
                VertexAttribute[VertexAttribute["CLR0"] = 11] = "CLR0";
                VertexAttribute[VertexAttribute["CLR1"] = 12] = "CLR1";
                VertexAttribute[VertexAttribute["TEX0"] = 13] = "TEX0";
                VertexAttribute[VertexAttribute["TEX1"] = 14] = "TEX1";
                VertexAttribute[VertexAttribute["TEX2"] = 15] = "TEX2";
                VertexAttribute[VertexAttribute["TEX3"] = 16] = "TEX3";
                VertexAttribute[VertexAttribute["TEX4"] = 17] = "TEX4";
                VertexAttribute[VertexAttribute["TEX5"] = 18] = "TEX5";
                VertexAttribute[VertexAttribute["TEX6"] = 19] = "TEX6";
                VertexAttribute[VertexAttribute["TEX7"] = 20] = "TEX7";
                VertexAttribute[VertexAttribute["NULL"] = 255] = "NULL";
            })(VertexAttribute || (VertexAttribute = {}));
            exports_3("VertexAttribute", VertexAttribute);
            (function (CompCnt) {
                CompCnt[CompCnt["POS_XY"] = 0] = "POS_XY";
                CompCnt[CompCnt["POS_XYZ"] = 1] = "POS_XYZ";
                CompCnt[CompCnt["CLR_RGB"] = 0] = "CLR_RGB";
                CompCnt[CompCnt["CLR_RGBA"] = 1] = "CLR_RGBA";
                CompCnt[CompCnt["TEX_S"] = 0] = "TEX_S";
                CompCnt[CompCnt["TEX_ST"] = 1] = "TEX_ST";
            })(CompCnt || (CompCnt = {}));
            exports_3("CompCnt", CompCnt);
            (function (CompType) {
                CompType[CompType["U8"] = 0] = "U8";
                CompType[CompType["S8"] = 1] = "S8";
                CompType[CompType["U16"] = 2] = "U16";
                CompType[CompType["S16"] = 3] = "S16";
                CompType[CompType["F32"] = 4] = "F32";
                CompType[CompType["RGBA8"] = 5] = "RGBA8";
            })(CompType || (CompType = {}));
            exports_3("CompType", CompType);
            (function (CompareType) {
                CompareType[CompareType["NEVER"] = 0] = "NEVER";
                CompareType[CompareType["LESS"] = 1] = "LESS";
                CompareType[CompareType["EQUAL"] = 2] = "EQUAL";
                CompareType[CompareType["LEQUAL"] = 3] = "LEQUAL";
                CompareType[CompareType["GREATER"] = 4] = "GREATER";
                CompareType[CompareType["NEQUAL"] = 5] = "NEQUAL";
                CompareType[CompareType["GEQUAL"] = 6] = "GEQUAL";
                CompareType[CompareType["ALWAYS"] = 7] = "ALWAYS";
            })(CompareType || (CompareType = {}));
            exports_3("CompareType", CompareType);
            (function (AlphaOp) {
                AlphaOp[AlphaOp["AND"] = 0] = "AND";
                AlphaOp[AlphaOp["OR"] = 1] = "OR";
                AlphaOp[AlphaOp["XOR"] = 2] = "XOR";
                AlphaOp[AlphaOp["XNOR"] = 3] = "XNOR";
            })(AlphaOp || (AlphaOp = {}));
            exports_3("AlphaOp", AlphaOp);
            (function (CullMode) {
                CullMode[CullMode["NONE"] = 0] = "NONE";
                CullMode[CullMode["FRONT"] = 1] = "FRONT";
                CullMode[CullMode["BACK"] = 2] = "BACK";
                CullMode[CullMode["ALL"] = 3] = "ALL";
            })(CullMode || (CullMode = {}));
            exports_3("CullMode", CullMode);
            (function (BlendMode) {
                BlendMode[BlendMode["ZERO"] = 0] = "ZERO";
                BlendMode[BlendMode["ONE"] = 1] = "ONE";
                BlendMode[BlendMode["SRCCLR"] = 2] = "SRCCLR";
                BlendMode[BlendMode["INVSRCCLR"] = 3] = "INVSRCCLR";
                BlendMode[BlendMode["SRCALPHA"] = 4] = "SRCALPHA";
                BlendMode[BlendMode["INVSRCALPHA"] = 5] = "INVSRCALPHA";
                BlendMode[BlendMode["DSTALPHA"] = 6] = "DSTALPHA";
                BlendMode[BlendMode["INVDSTALPHA"] = 7] = "INVDSTALPHA";
            })(BlendMode || (BlendMode = {}));
            exports_3("BlendMode", BlendMode);
            (function (TevOp) {
                TevOp[TevOp["ADD"] = 0] = "ADD";
                TevOp[TevOp["SUB"] = 1] = "SUB";
                TevOp[TevOp["COMP_R8_GT"] = 8] = "COMP_R8_GT";
                TevOp[TevOp["COMP_R8_EQ"] = 9] = "COMP_R8_EQ";
                TevOp[TevOp["COMP_GR16_GT"] = 10] = "COMP_GR16_GT";
                TevOp[TevOp["COMP_GR16_EQ"] = 11] = "COMP_GR16_EQ";
                TevOp[TevOp["COMP_BGR24_GT"] = 12] = "COMP_BGR24_GT";
                TevOp[TevOp["COMP_BGR24_EQ"] = 13] = "COMP_BGR24_EQ";
                TevOp[TevOp["COMP_RGB8_GT"] = 14] = "COMP_RGB8_GT";
                TevOp[TevOp["COMP_RGB8_EQ"] = 15] = "COMP_RGB8_EQ";
            })(TevOp || (TevOp = {}));
            exports_3("TevOp", TevOp);
            (function (TevBias) {
                TevBias[TevBias["ZERO"] = 0] = "ZERO";
                TevBias[TevBias["ADDHALF"] = 1] = "ADDHALF";
                TevBias[TevBias["SUBHALF"] = 2] = "SUBHALF";
            })(TevBias || (TevBias = {}));
            exports_3("TevBias", TevBias);
            (function (TevScale) {
                TevScale[TevScale["SCALE_1"] = 0] = "SCALE_1";
                TevScale[TevScale["SCALE_2"] = 1] = "SCALE_2";
                TevScale[TevScale["SCALE_4"] = 2] = "SCALE_4";
                TevScale[TevScale["DIVIDE_2"] = 3] = "DIVIDE_2";
            })(TevScale || (TevScale = {}));
            exports_3("TevScale", TevScale);
            (function (CombineColorInput) {
                CombineColorInput[CombineColorInput["CPREV"] = 0] = "CPREV";
                CombineColorInput[CombineColorInput["APREV"] = 1] = "APREV";
                CombineColorInput[CombineColorInput["C0"] = 2] = "C0";
                CombineColorInput[CombineColorInput["A0"] = 3] = "A0";
                CombineColorInput[CombineColorInput["C1"] = 4] = "C1";
                CombineColorInput[CombineColorInput["A1"] = 5] = "A1";
                CombineColorInput[CombineColorInput["C2"] = 6] = "C2";
                CombineColorInput[CombineColorInput["A2"] = 7] = "A2";
                CombineColorInput[CombineColorInput["TEXC"] = 8] = "TEXC";
                CombineColorInput[CombineColorInput["TEXA"] = 9] = "TEXA";
                CombineColorInput[CombineColorInput["RASC"] = 10] = "RASC";
                CombineColorInput[CombineColorInput["RASA"] = 11] = "RASA";
                CombineColorInput[CombineColorInput["ONE"] = 12] = "ONE";
                CombineColorInput[CombineColorInput["HALF"] = 13] = "HALF";
                CombineColorInput[CombineColorInput["KONST"] = 14] = "KONST";
                CombineColorInput[CombineColorInput["ZERO"] = 15] = "ZERO";
            })(CombineColorInput || (CombineColorInput = {}));
            exports_3("CombineColorInput", CombineColorInput);
            (function (CombineAlphaInput) {
                CombineAlphaInput[CombineAlphaInput["APREV"] = 0] = "APREV";
                CombineAlphaInput[CombineAlphaInput["A0"] = 1] = "A0";
                CombineAlphaInput[CombineAlphaInput["A1"] = 2] = "A1";
                CombineAlphaInput[CombineAlphaInput["A2"] = 3] = "A2";
                CombineAlphaInput[CombineAlphaInput["TEXA"] = 4] = "TEXA";
                CombineAlphaInput[CombineAlphaInput["RASA"] = 5] = "RASA";
                CombineAlphaInput[CombineAlphaInput["KONST"] = 6] = "KONST";
                CombineAlphaInput[CombineAlphaInput["ZERO"] = 7] = "ZERO";
            })(CombineAlphaInput || (CombineAlphaInput = {}));
            exports_3("CombineAlphaInput", CombineAlphaInput);
            (function (KonstColorSel) {
                KonstColorSel[KonstColorSel["KCSEL_1"] = 0] = "KCSEL_1";
                KonstColorSel[KonstColorSel["KCSEL_7_8"] = 1] = "KCSEL_7_8";
                KonstColorSel[KonstColorSel["KCSEL_3_4"] = 2] = "KCSEL_3_4";
                KonstColorSel[KonstColorSel["KCSEL_5_8"] = 3] = "KCSEL_5_8";
                KonstColorSel[KonstColorSel["KCSEL_1_2"] = 4] = "KCSEL_1_2";
                KonstColorSel[KonstColorSel["KCSEL_3_8"] = 5] = "KCSEL_3_8";
                KonstColorSel[KonstColorSel["KCSEL_1_4"] = 6] = "KCSEL_1_4";
                KonstColorSel[KonstColorSel["KCSEL_1_8"] = 7] = "KCSEL_1_8";
                KonstColorSel[KonstColorSel["KCSEL_K0"] = 12] = "KCSEL_K0";
                KonstColorSel[KonstColorSel["KCSEL_K1"] = 13] = "KCSEL_K1";
                KonstColorSel[KonstColorSel["KCSEL_K2"] = 14] = "KCSEL_K2";
                KonstColorSel[KonstColorSel["KCSEL_K3"] = 15] = "KCSEL_K3";
                KonstColorSel[KonstColorSel["KCSEL_K0_R"] = 16] = "KCSEL_K0_R";
                KonstColorSel[KonstColorSel["KCSEL_K1_R"] = 17] = "KCSEL_K1_R";
                KonstColorSel[KonstColorSel["KCSEL_K2_R"] = 18] = "KCSEL_K2_R";
                KonstColorSel[KonstColorSel["KCSEL_K3_R"] = 19] = "KCSEL_K3_R";
                KonstColorSel[KonstColorSel["KCSEL_K0_G"] = 20] = "KCSEL_K0_G";
                KonstColorSel[KonstColorSel["KCSEL_K1_G"] = 21] = "KCSEL_K1_G";
                KonstColorSel[KonstColorSel["KCSEL_K2_G"] = 22] = "KCSEL_K2_G";
                KonstColorSel[KonstColorSel["KCSEL_K3_G"] = 23] = "KCSEL_K3_G";
                KonstColorSel[KonstColorSel["KCSEL_K0_B"] = 24] = "KCSEL_K0_B";
                KonstColorSel[KonstColorSel["KCSEL_K1_B"] = 25] = "KCSEL_K1_B";
                KonstColorSel[KonstColorSel["KCSEL_K2_B"] = 26] = "KCSEL_K2_B";
                KonstColorSel[KonstColorSel["KCSEL_K3_B"] = 27] = "KCSEL_K3_B";
                KonstColorSel[KonstColorSel["KCSEL_K0_A"] = 28] = "KCSEL_K0_A";
                KonstColorSel[KonstColorSel["KCSEL_K1_A"] = 29] = "KCSEL_K1_A";
                KonstColorSel[KonstColorSel["KCSEL_K2_A"] = 30] = "KCSEL_K2_A";
                KonstColorSel[KonstColorSel["KCSEL_K3_A"] = 31] = "KCSEL_K3_A";
            })(KonstColorSel || (KonstColorSel = {}));
            exports_3("KonstColorSel", KonstColorSel);
            (function (KonstAlphaSel) {
                KonstAlphaSel[KonstAlphaSel["KASEL_1"] = 0] = "KASEL_1";
                KonstAlphaSel[KonstAlphaSel["KASEL_7_8"] = 1] = "KASEL_7_8";
                KonstAlphaSel[KonstAlphaSel["KASEL_3_4"] = 2] = "KASEL_3_4";
                KonstAlphaSel[KonstAlphaSel["KASEL_5_8"] = 3] = "KASEL_5_8";
                KonstAlphaSel[KonstAlphaSel["KASEL_1_2"] = 4] = "KASEL_1_2";
                KonstAlphaSel[KonstAlphaSel["KASEL_3_8"] = 5] = "KASEL_3_8";
                KonstAlphaSel[KonstAlphaSel["KASEL_1_4"] = 6] = "KASEL_1_4";
                KonstAlphaSel[KonstAlphaSel["KASEL_1_8"] = 7] = "KASEL_1_8";
                KonstAlphaSel[KonstAlphaSel["KASEL_K0_R"] = 16] = "KASEL_K0_R";
                KonstAlphaSel[KonstAlphaSel["KASEL_K1_R"] = 17] = "KASEL_K1_R";
                KonstAlphaSel[KonstAlphaSel["KASEL_K2_R"] = 18] = "KASEL_K2_R";
                KonstAlphaSel[KonstAlphaSel["KASEL_K3_R"] = 19] = "KASEL_K3_R";
                KonstAlphaSel[KonstAlphaSel["KASEL_K0_G"] = 20] = "KASEL_K0_G";
                KonstAlphaSel[KonstAlphaSel["KASEL_K1_G"] = 21] = "KASEL_K1_G";
                KonstAlphaSel[KonstAlphaSel["KASEL_K2_G"] = 22] = "KASEL_K2_G";
                KonstAlphaSel[KonstAlphaSel["KASEL_K3_G"] = 23] = "KASEL_K3_G";
                KonstAlphaSel[KonstAlphaSel["KASEL_K0_B"] = 24] = "KASEL_K0_B";
                KonstAlphaSel[KonstAlphaSel["KASEL_K1_B"] = 25] = "KASEL_K1_B";
                KonstAlphaSel[KonstAlphaSel["KASEL_K2_B"] = 26] = "KASEL_K2_B";
                KonstAlphaSel[KonstAlphaSel["KASEL_K3_B"] = 27] = "KASEL_K3_B";
                KonstAlphaSel[KonstAlphaSel["KASEL_K0_A"] = 28] = "KASEL_K0_A";
                KonstAlphaSel[KonstAlphaSel["KASEL_K1_A"] = 29] = "KASEL_K1_A";
                KonstAlphaSel[KonstAlphaSel["KASEL_K2_A"] = 30] = "KASEL_K2_A";
                KonstAlphaSel[KonstAlphaSel["KASEL_K3_A"] = 31] = "KASEL_K3_A";
            })(KonstAlphaSel || (KonstAlphaSel = {}));
            exports_3("KonstAlphaSel", KonstAlphaSel);
            (function (TexFormat) {
                TexFormat[TexFormat["I4"] = 0] = "I4";
                TexFormat[TexFormat["I8"] = 1] = "I8";
                TexFormat[TexFormat["IA4"] = 2] = "IA4";
                TexFormat[TexFormat["IA8"] = 3] = "IA8";
                TexFormat[TexFormat["RGB565"] = 4] = "RGB565";
                TexFormat[TexFormat["RGB5A3"] = 5] = "RGB5A3";
                TexFormat[TexFormat["RGBA8"] = 6] = "RGBA8";
                TexFormat[TexFormat["CI4"] = 8] = "CI4";
                TexFormat[TexFormat["CI8"] = 9] = "CI8";
                TexFormat[TexFormat["CI14"] = 10] = "CI14";
                TexFormat[TexFormat["CMPR"] = 14] = "CMPR";
            })(TexFormat || (TexFormat = {}));
            exports_3("TexFormat", TexFormat);
            (function (TexPalette) {
                TexPalette[TexPalette["IA8"] = 0] = "IA8";
                TexPalette[TexPalette["RGB565"] = 1] = "RGB565";
                TexPalette[TexPalette["RGB5A3"] = 2] = "RGB5A3";
            })(TexPalette || (TexPalette = {}));
            exports_3("TexPalette", TexPalette);
            (function (TexFilter) {
                TexFilter[TexFilter["NEAR"] = 0] = "NEAR";
                TexFilter[TexFilter["LINEAR"] = 1] = "LINEAR";
                TexFilter[TexFilter["NEAR_MIP_NEAR"] = 2] = "NEAR_MIP_NEAR";
                TexFilter[TexFilter["LIN_MIP_NEAR"] = 3] = "LIN_MIP_NEAR";
                TexFilter[TexFilter["NEAR_MIP_LIN"] = 4] = "NEAR_MIP_LIN";
                TexFilter[TexFilter["LIN_MIP_LIN"] = 5] = "LIN_MIP_LIN";
            })(TexFilter || (TexFilter = {}));
            exports_3("TexFilter", TexFilter);
            (function (WrapMode) {
                WrapMode[WrapMode["CLAMP"] = 0] = "CLAMP";
                WrapMode[WrapMode["REPEAT"] = 1] = "REPEAT";
                WrapMode[WrapMode["MIRROR"] = 2] = "MIRROR";
            })(WrapMode || (WrapMode = {}));
            exports_3("WrapMode", WrapMode);
            (function (ColorSrc) {
                ColorSrc[ColorSrc["REG"] = 0] = "REG";
                ColorSrc[ColorSrc["VTX"] = 1] = "VTX";
            })(ColorSrc || (ColorSrc = {}));
            exports_3("ColorSrc", ColorSrc);
            (function (TexGenSrc) {
                TexGenSrc[TexGenSrc["POS"] = 0] = "POS";
                TexGenSrc[TexGenSrc["NRM"] = 1] = "NRM";
                TexGenSrc[TexGenSrc["BINRM"] = 2] = "BINRM";
                TexGenSrc[TexGenSrc["TANGENT"] = 3] = "TANGENT";
                TexGenSrc[TexGenSrc["TEX0"] = 4] = "TEX0";
                TexGenSrc[TexGenSrc["TEX1"] = 5] = "TEX1";
                TexGenSrc[TexGenSrc["TEX2"] = 6] = "TEX2";
                TexGenSrc[TexGenSrc["TEX3"] = 7] = "TEX3";
                TexGenSrc[TexGenSrc["TEX4"] = 8] = "TEX4";
                TexGenSrc[TexGenSrc["TEX5"] = 9] = "TEX5";
                TexGenSrc[TexGenSrc["TEX6"] = 10] = "TEX6";
                TexGenSrc[TexGenSrc["TEX7"] = 11] = "TEX7";
            })(TexGenSrc || (TexGenSrc = {}));
            exports_3("TexGenSrc", TexGenSrc);
            (function (TexGenType) {
                TexGenType[TexGenType["MTX3x4"] = 0] = "MTX3x4";
                TexGenType[TexGenType["MTX2x4"] = 1] = "MTX2x4";
                TexGenType[TexGenType["BUMP0"] = 2] = "BUMP0";
                TexGenType[TexGenType["BUMP1"] = 3] = "BUMP1";
                TexGenType[TexGenType["BUMP2"] = 4] = "BUMP2";
                TexGenType[TexGenType["BUMP3"] = 5] = "BUMP3";
                TexGenType[TexGenType["BUMP4"] = 6] = "BUMP4";
                TexGenType[TexGenType["BUMP5"] = 7] = "BUMP5";
                TexGenType[TexGenType["BUMP6"] = 8] = "BUMP6";
                TexGenType[TexGenType["BUMP7"] = 9] = "BUMP7";
                TexGenType[TexGenType["SRTG"] = 10] = "SRTG";
            })(TexGenType || (TexGenType = {}));
            exports_3("TexGenType", TexGenType);
            (function (TexGenMatrix) {
                TexGenMatrix[TexGenMatrix["IDENTITY"] = 60] = "IDENTITY";
                TexGenMatrix[TexGenMatrix["TEXMTX0"] = 30] = "TEXMTX0";
                TexGenMatrix[TexGenMatrix["TEXMTX1"] = 33] = "TEXMTX1";
                TexGenMatrix[TexGenMatrix["TEXMTX2"] = 36] = "TEXMTX2";
                TexGenMatrix[TexGenMatrix["TEXMTX3"] = 39] = "TEXMTX3";
                TexGenMatrix[TexGenMatrix["TEXMTX4"] = 42] = "TEXMTX4";
                TexGenMatrix[TexGenMatrix["TEXMTX5"] = 45] = "TEXMTX5";
                TexGenMatrix[TexGenMatrix["TEXMTX6"] = 48] = "TEXMTX6";
                TexGenMatrix[TexGenMatrix["TEXMTX7"] = 51] = "TEXMTX7";
                TexGenMatrix[TexGenMatrix["TEXMTX8"] = 54] = "TEXMTX8";
                TexGenMatrix[TexGenMatrix["TEXMTX9"] = 57] = "TEXMTX9";
            })(TexGenMatrix || (TexGenMatrix = {}));
            exports_3("TexGenMatrix", TexGenMatrix);
        }
    };
});
System.register("j3d/texture", ["j3d/gx"], function (exports_4, context_4) {
    "use strict";
    var __moduleName = context_4 && context_4.id;
    function expand3to8(n) {
        return (n << (8 - 3)) | (n << (8 - 6)) | (n >>> (9 - 8));
    }
    function expand4to8(n) {
        return (n << 4) | n;
    }
    function expand5to8(n) {
        return (n << (8 - 5)) | (n >>> (10 - 8));
    }
    function expand6to8(n) {
        return (n << (8 - 6)) | (n >>> (12 - 8));
    }
    // GX uses a HW approximation of 3/8 + 5/8 instead of 1/3 + 2/3.
    function s3tcblend(a, b) {
        // return (a*3 + b*5) / 8;
        return (((a << 1) + a) + ((b << 2) + b)) >>> 3;
    }
    // GX's CMPR format is S3TC but using GX's tiled addressing.
    function decode_CMPR_to_S3TC(texture) {
        // CMPR goes in 2x2 "macro-blocks" of four S3TC normal blocks.
        function reverseByte(v) {
            // Reverse the order of the four half-nibbles.
            return ((v & 0x03) << 6) | ((v & 0x0c) << 2) | ((v & 0x30) >>> 2) | ((v & 0xc0) >>> 6);
        }
        var pixels = new Uint8Array(texture.width * texture.height / 2);
        var view = new DataView(texture.data);
        // "Macroblocks"
        var w4 = texture.width >>> 2;
        var srcOffs = 0;
        for (var yy = 0; yy < texture.height; yy += 8) {
            for (var xx = 0; xx < texture.width; xx += 8) {
                // S3TC blocks.
                for (var y = 0; y < 2; y++) {
                    for (var x = 0; x < 2; x++) {
                        var dstBlock = (yy + y) * w4 + xx + x;
                        var dstOffs = dstBlock * 8;
                        pixels[dstOffs + 0] = view.getUint8(srcOffs + 1);
                        pixels[dstOffs + 1] = view.getUint8(srcOffs + 0);
                        pixels[dstOffs + 2] = view.getUint8(srcOffs + 2);
                        pixels[dstOffs + 3] = view.getUint8(srcOffs + 3);
                        pixels[dstOffs + 0] = reverseByte(view.getUint8(srcOffs + 0));
                        pixels[dstOffs + 1] = reverseByte(view.getUint8(srcOffs + 1));
                        pixels[dstOffs + 2] = reverseByte(view.getUint8(srcOffs + 2));
                        pixels[dstOffs + 3] = reverseByte(view.getUint8(srcOffs + 3));
                    }
                }
                srcOffs += 8;
            }
        }
        return { type: "S3TC", pixels: pixels.buffer, width: texture.width, height: texture.height };
    }
    // Software decodes from standard S3TC (not CMPR!) to RGBA.
    function decode_S3TC(texture) {
        var pixels = new Uint8Array(texture.width * texture.height * 4);
        var view = new DataView(texture.pixels);
        var colorTable = new Uint8Array(16);
        var srcOffs = 0;
        for (var yy = 0; yy < texture.height; yy += 4) {
            for (var xx = 0; xx < texture.width; xx += 4) {
                var color1 = view.getUint16(srcOffs + 0x00, true);
                var color2 = view.getUint16(srcOffs + 0x02, true);
                // Fill in first two colors in color table.
                colorTable[0] = expand5to8((color1 >> 11) & 0x1F);
                colorTable[1] = expand6to8((color1 >> 5) & 0x3F);
                colorTable[2] = expand5to8(color1 & 0x1F);
                colorTable[3] = 0xFF;
                colorTable[4] = expand5to8((color2 >> 11) & 0x1F);
                colorTable[5] = expand6to8((color2 >> 5) & 0x3F);
                colorTable[6] = expand5to8(color2 & 0x1F);
                colorTable[7] = 0xFF;
                if (color1 > color2) {
                    // Predict gradients.
                    colorTable[8] = s3tcblend(colorTable[4], colorTable[0]);
                    colorTable[9] = s3tcblend(colorTable[5], colorTable[1]);
                    colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                    colorTable[11] = 0xFF;
                    colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                    colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                    colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                    colorTable[15] = 0xFF;
                }
                else {
                    colorTable[8] = (colorTable[0] + colorTable[4]) >>> 1;
                    colorTable[9] = (colorTable[1] + colorTable[5]) >>> 1;
                    colorTable[10] = (colorTable[2] + colorTable[6]) >>> 1;
                    colorTable[11] = 0xFF;
                    // GX difference: GX fills with an alpha 0 midway point here.
                    colorTable[12] = colorTable[8];
                    colorTable[13] = colorTable[9];
                    colorTable[14] = colorTable[10];
                    colorTable[15] = 0x00;
                }
                var bits = view.getUint32(srcOffs + 0x04, true);
                for (var y = 0; y < 4; y++) {
                    for (var x = 0; x < 4; x++) {
                        var dstPx = (yy + y) * texture.width + xx + x;
                        var dstOffs = dstPx * 4;
                        var colorIdx = bits & 0x03;
                        pixels[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                        pixels[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                        pixels[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                        pixels[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                        bits >>= 2;
                    }
                }
                srcOffs += 8;
            }
        }
        return { type: "RGBA", pixels: pixels.buffer, width: texture.width, height: texture.height };
    }
    function decode_Tiled(texture, decoder) {
        var pixels = new Uint8Array(texture.width * texture.height * 4);
        for (var yy = 0; yy < texture.height; yy += 8) {
        }
        return { type: "RGBA", pixels: pixels.buffer, width: texture.width, height: texture.height };
    }
    function decode_RGB565(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var p = view.getUint16(srcOffs, true);
            pixels[0] = expand5to8((p >> 11) & 0x1F);
            pixels[1] = expand6to8((p >> 5) & 0x3F);
            pixels[2] = expand5to8(p & 0x1F);
            pixels[3] = 0xFF;
            srcOffs += 2;
        });
    }
    function decode_RGB5A3(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var p = view.getUint16(srcOffs, true);
            if (p & 0x8000) {
                // RGB5
                pixels[0] = expand5to8(p >> 11);
                pixels[1] = expand5to8((p >> 5) & 0x1F);
                pixels[2] = expand5to8(p & 0x1F);
                pixels[3] = 0xFF;
            }
            else {
                // A3RGB4
                pixels[3] = expand3to8(p >> 12);
                pixels[0] = expand4to8((p >> 8) & 0x0F);
                pixels[1] = expand4to8((p >> 4) & 0x0F);
                pixels[2] = expand4to8(p & 0x0F);
            }
            srcOffs += 2;
        });
    }
    function decode_RGBA8(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            pixels[dstOffs + 0] = view.getUint8(srcOffs + 0);
            pixels[dstOffs + 1] = view.getUint8(srcOffs + 1);
            pixels[dstOffs + 2] = view.getUint8(srcOffs + 2);
            pixels[dstOffs + 3] = view.getUint8(srcOffs + 3);
            srcOffs += 4;
        });
    }
    function decode_I4(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var ii = view.getUint8(srcOffs >> 1);
            var i4 = ii >>> ((srcOffs & 1) ? 0 : 4) & 0x0F;
            var i = expand4to8(i4);
            pixels[dstOffs + 0] = i;
            pixels[dstOffs + 1] = i;
            pixels[dstOffs + 2] = i;
            pixels[dstOffs + 3] = i;
            srcOffs++;
        });
    }
    function decode_I8(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var i = view.getUint8(srcOffs);
            pixels[dstOffs + 0] = i;
            pixels[dstOffs + 1] = i;
            pixels[dstOffs + 2] = i;
            pixels[dstOffs + 3] = i;
            srcOffs++;
        });
    }
    function decode_IA4(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var ia = view.getUint8(srcOffs);
            var i = expand4to8(ia >>> 4);
            var a = expand4to8(ia & 0x0F);
            pixels[dstOffs + 0] = i;
            pixels[dstOffs + 1] = i;
            pixels[dstOffs + 2] = i;
            pixels[dstOffs + 3] = a;
            srcOffs++;
        });
    }
    function decode_IA8(texture) {
        var view = new DataView(texture.data);
        var srcOffs = 0;
        return decode_Tiled(texture, function (pixels, dstOffs) {
            var i = view.getUint8(srcOffs + 0);
            var a = view.getUint8(srcOffs + 1);
            pixels[dstOffs + 0] = i;
            pixels[dstOffs + 1] = i;
            pixels[dstOffs + 2] = i;
            pixels[dstOffs + 3] = a;
            srcOffs += 2;
        });
    }
    function decodeTexture(texture, supportsS3TC) {
        switch (texture.format) {
            case GX.TexFormat.CMPR:
                var s3tc = decode_CMPR_to_S3TC(texture);
                if (supportsS3TC)
                    return s3tc;
                else
                    return decode_S3TC(s3tc);
            case GX.TexFormat.RGB565:
                return decode_RGB565(texture);
            case GX.TexFormat.RGB5A3:
                return decode_RGB5A3(texture);
            case GX.TexFormat.RGBA8:
                return decode_RGBA8(texture);
            case GX.TexFormat.I4:
                return decode_I4(texture);
            case GX.TexFormat.I8:
                return decode_I8(texture);
            case GX.TexFormat.IA4:
                return decode_IA4(texture);
            case GX.TexFormat.IA8:
                return decode_IA8(texture);
            case GX.TexFormat.CI4:
            case GX.TexFormat.CI8:
            case GX.TexFormat.CI14:
                throw new Error("Unsupported texture format " + texture.format);
            default: var m = texture.format;
        }
    }
    exports_4("decodeTexture", decodeTexture);
    var GX;
    return {
        setters: [
            function (GX_1) {
                GX = GX_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("util", [], function (exports_5, context_5) {
    "use strict";
    var __moduleName = context_5 && context_5.id;
    function fetch(path) {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = "arraybuffer";
        request.send();
        return new Promise(function (resolve, reject) {
            request.onload = function () {
                resolve(request.response);
            };
            request.onerror = function () {
                reject();
            };
        });
    }
    exports_5("fetch", fetch);
    function assert(b) {
        if (!b)
            throw new Error("Assert fail");
    }
    exports_5("assert", assert);
    function readString(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var S = '';
        for (var i = 0; i < length; i++) {
            if (buf[i] === 0)
                break;
            S += String.fromCharCode(buf[i]);
        }
        return S;
    }
    exports_5("readString", readString);
    return {
        setters: [],
        execute: function () {
        }
    };
});
System.register("j3d/bmd", ["j3d/gx", "j3d/texture", "util"], function (exports_6, context_6) {
    "use strict";
    var __moduleName = context_6 && context_6.id;
    function readString(buffer, offs, length) {
        var length2 = Math.min(length, buffer.byteLength - offs);
        var buf = new Uint8Array(buffer, offs, length2);
        var S = '';
        for (var i = 0; i < buf.byteLength; i++) {
            if (buf[i] === 0)
                break;
            S += String.fromCharCode(buf[i]);
        }
        return S;
    }
    function readStringTable(buffer, offs) {
        var view = new DataView(buffer, offs);
        var stringCount = view.getUint16(0x00);
        var tableIdx = 0x06;
        var strings = [];
        for (var i = 0; i < stringCount; i++) {
            var stringOffs = view.getUint16(tableIdx);
            var str = readString(buffer, offs + stringOffs, 255);
            strings.push(str);
            tableIdx += 0x04;
        }
        return strings;
    }
    function memcpy(dst, dstOffs, src, srcOffs, length) {
        new Uint8Array(dst).set(new Uint8Array(src, srcOffs, length), dstOffs);
    }
    function readINF1Chunk(bmd, buffer, chunkStart, chunkSize) {
        var view = new DataView(buffer, chunkStart, chunkSize);
        // unk
        var packetCount = view.getUint32(0x0C);
        var vertexCount = view.getUint32(0x10);
        var hierarchyOffs = view.getUint32(0x14);
        var parentStack = [];
        var node = { type: HierarchyType.Open, children: [] };
        var offs = hierarchyOffs;
        outer: while (true) {
            var type = view.getUint16(offs + 0x00);
            var value = view.getUint16(offs + 0x02);
            offs += 0x04;
            switch (type) {
                case HierarchyType.End:
                    break outer;
                case HierarchyType.Open:
                    parentStack.push(node);
                    node.children.push(node = { type: HierarchyType.Open, children: [] });
                    break;
                case HierarchyType.Close:
                    node = parentStack.pop();
                    break;
                case HierarchyType.Joint:
                    node.children.push({ type: type, jointIdx: value });
                    break;
                case HierarchyType.Material:
                    node.children.push({ type: type, materialIdx: value });
                    break;
                case HierarchyType.Shape:
                    node.children.push({ type: type, shapeIdx: value });
                    break;
            }
        }
        util_1.assert(parentStack.length === 0);
        bmd.inf1 = { sceneGraph: node };
    }
    function getComponentSize(dataType) {
        switch (dataType) {
            case GX.CompType.U8:
            case GX.CompType.S8:
            case GX.CompType.RGBA8:
                return 1;
            case GX.CompType.U16:
            case GX.CompType.S16:
                return 2;
            case GX.CompType.F32:
                return 4;
        }
    }
    function getNumComponents(vtxAttrib, componentCount) {
        switch (vtxAttrib) {
            case GX.VertexAttribute.POS:
                if (componentCount === GX.CompCnt.POS_XY)
                    return 2;
                else if (componentCount === GX.CompCnt.POS_XYZ)
                    return 3;
            case GX.VertexAttribute.NRM:
                return 3;
            case GX.VertexAttribute.CLR0:
            case GX.VertexAttribute.CLR1:
                if (componentCount === GX.CompCnt.CLR_RGB)
                    return 3;
                else if (componentCount === GX.CompCnt.CLR_RGBA)
                    return 4;
            case GX.VertexAttribute.TEX0:
            case GX.VertexAttribute.TEX1:
            case GX.VertexAttribute.TEX2:
            case GX.VertexAttribute.TEX3:
            case GX.VertexAttribute.TEX4:
            case GX.VertexAttribute.TEX5:
            case GX.VertexAttribute.TEX6:
            case GX.VertexAttribute.TEX7:
                if (componentCount === GX.CompCnt.TEX_S)
                    return 1;
                else if (componentCount === GX.CompCnt.TEX_ST)
                    return 2;
            default:
                throw new Error("Unknown vertex attribute " + vtxAttrib);
        }
    }
    function readVTX1Chunk(bmd, buffer, chunkStart, chunkSize) {
        var view = new DataView(buffer, chunkStart, chunkSize);
        var formatOffs = view.getUint32(0x08);
        var dataOffsLookupTable = 0x0C;
        var offs = formatOffs;
        var i = 0;
        var vertexArrays = new Map();
        while (true) {
            // Parse out the vertex formats.
            var formatIdx = i++;
            var vtxAttrib = view.getUint32(offs + 0x00);
            if (vtxAttrib === GX.VertexAttribute.NULL)
                break;
            var compCnt = view.getUint32(offs + 0x04);
            var compType = view.getUint32(offs + 0x08);
            var decimalPoint = view.getUint8(offs + 0x0C);
            offs += 0x10;
            // Each attrib in the VTX1 chunk also has a corresponding data chunk containing
            // the data for that attribute, in the format stored above.
            // BMD doesn't tell us how big each data chunk is, but we need to know to figure
            // out how much data to upload. We assume the data offset lookup table is sorted
            // in order, and can figure it out by finding the next offset above us.
            var dataOffsLookupTableEntry = dataOffsLookupTable + formatIdx * 0x04;
            var dataStart = view.getUint32(dataOffsLookupTableEntry);
            var dataEnd = getDataEnd(dataOffsLookupTableEntry);
            var dataOffs = offs + dataStart;
            var dataSize = dataEnd - dataStart;
            var compCount = getNumComponents(vtxAttrib, compCnt);
            var compSize = getComponentSize(compType);
            var vertexArray = { vtxAttrib: vtxAttrib, compType: compType, compCount: compCount, compSize: compSize, dataOffs: dataOffs, dataSize: dataSize };
            vertexArrays.set(vtxAttrib, vertexArray);
        }
        bmd.vtx1 = { vertexArrays: vertexArrays, buffer: buffer };
        function getDataEnd(dataOffsLookupTableEntry) {
            var offs = dataOffsLookupTableEntry + 0x04;
            while (offs < dataOffsLookupTableEntry) {
                var dataOffs = view.getUint32(offs);
                if (dataOffs !== 0)
                    return dataOffs;
                offs += 0x04;
            }
            // If we can't find anything in the array, the chunks end at the chunk size.
            return chunkSize;
        }
    }
    function readIndex(view, offs, type) {
        switch (type) {
            case GX.CompType.U8:
            case GX.CompType.S8:
                return view.getUint8(offs);
            case GX.CompType.U16:
            case GX.CompType.S16:
                return view.getUint16(offs);
            default:
                throw new Error("Unknown index data type " + type + "!");
        }
    }
    function readSHP1Chunk(bmd, buffer, chunkStart, chunkSize) {
        var view = new DataView(buffer, chunkStart, chunkSize);
        var shapeCount = view.getUint16(0x08);
        var shapeTableOffs = view.getUint32(0x0C);
        var attribTableOffs = view.getUint32(0x18);
        var matrixTableOffs = view.getUint32(0x1C);
        var primDataOffs = view.getUint32(0x20);
        var matrixDataOffs = view.getUint32(0x24);
        var packetTableOffs = view.getUint32(0x28);
        // We have a number of "shapes". Each shape has a number of vertex attributes
        // (e.g. pos, nrm, txc) and a list of packets. Each packet has a list of draw
        // calls, and each draw call has a list of indices into *each* of the vertex
        // arrays, one per vertex.
        //
        // Instead of one global index per draw call like OGL and some amount of packed
        // vertex data, the GX instead allows specifying separate indices per attribute.
        // So you can have POS's indexes be 0 1 2 3 and NRM's indexes be 0 0 0 0.
        //
        // What we end up doing is similar to what Dolphin does with its vertex loader
        // JIT. We construct buffers for each of the components that are shape-specific.
        var shapes = [];
        var shapeIdx = shapeTableOffs;
        for (var i = 0; i < shapeCount; i++) {
            var matrixType = view.getUint8(shapeIdx + 0x00);
            var packetCount = view.getUint16(shapeIdx + 0x02);
            var attribOffs = view.getUint16(shapeIdx + 0x04);
            var firstMatrix = view.getUint16(shapeIdx + 0x06);
            var firstPacket = view.getUint16(shapeIdx + 0x08);
            // Go parse out what attributes are required for this shape.
            var packedVertexAttributes = [];
            var attribIdx = attribTableOffs + attribOffs;
            var vertexIndexSize = 0;
            var packedVertexSize = 0;
            while (true) {
                var vtxAttrib = view.getUint32(attribIdx + 0x00);
                if (vtxAttrib === GX.VertexAttribute.NULL)
                    break;
                var indexDataType = view.getUint32(attribIdx + 0x04);
                var indexDataSize = getComponentSize(indexDataType);
                var offset = packedVertexSize;
                packedVertexAttributes.push({ vtxAttrib: vtxAttrib, indexDataType: indexDataType, offset: offset });
                attribIdx += 0x08;
                vertexIndexSize += indexDataSize;
                var vertexArray = bmd.vtx1.vertexArrays.get(vtxAttrib);
                packedVertexSize += vertexArray.compSize * vertexArray.compCount;
            }
            // Now parse out the packets.
            var packetIdx = packetTableOffs + (firstPacket * 0x08);
            var drawCalls = [];
            var totalVertexCount = 0;
            for (var j = 0; j < packetCount; j++) {
                var packetSize = view.getUint32(packetIdx + 0x00);
                var packetStart = primDataOffs + view.getUint32(packetIdx + 0x04);
                // XXX: We need an "update matrix table" command here in the draw call list.
                var drawCallEnd = packetStart + packetSize;
                var drawCallIdx = packetStart;
                while (true) {
                    if (drawCallIdx > drawCallEnd)
                        break;
                    var primType = view.getUint8(drawCallIdx);
                    if (primType === 0)
                        break;
                    var vertexCount = view.getUint16(drawCallIdx + 0x01);
                    drawCallIdx += 0x03;
                    var srcOffs = drawCallIdx;
                    var first = totalVertexCount;
                    totalVertexCount += vertexCount;
                    // Skip over the index data.
                    drawCallIdx += vertexIndexSize * vertexCount;
                    drawCalls.push({ primType: primType, vertexCount: vertexCount, first: first, srcOffs: srcOffs });
                }
                packetIdx += 0x08;
            }
            // Now copy our data into it.
            var packedDataSize = packedVertexSize * totalVertexCount;
            var packedData = new ArrayBuffer(packedDataSize);
            var packedDataOffs = 0;
            try {
                for (var drawCalls_1 = __values(drawCalls), drawCalls_1_1 = drawCalls_1.next(); !drawCalls_1_1.done; drawCalls_1_1 = drawCalls_1.next()) {
                    var drawCall = drawCalls_1_1.value;
                    var drawCallIdx = drawCall.srcOffs;
                    for (var j = 0; j < drawCall.vertexCount; j++) {
                        var packedDataOffs_ = packedDataOffs;
                        try {
                            for (var packedVertexAttributes_1 = __values(packedVertexAttributes), packedVertexAttributes_1_1 = packedVertexAttributes_1.next(); !packedVertexAttributes_1_1.done; packedVertexAttributes_1_1 = packedVertexAttributes_1.next()) {
                                var attrib = packedVertexAttributes_1_1.value;
                                var index = readIndex(view, drawCallIdx, attrib.indexDataType);
                                var indexDataSize = getComponentSize(attrib.indexDataType);
                                drawCallIdx += indexDataSize;
                                var vertexArray = bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);
                                var attribDataSize = vertexArray.compSize * vertexArray.compCount;
                                var srcOffs = vertexArray.dataOffs + (attribDataSize * index);
                                memcpy(packedData, packedDataOffs, bmd.vtx1.buffer, srcOffs, attribDataSize);
                                packedDataOffs += attribDataSize;
                            }
                        }
                        catch (e_1_1) { e_1 = { error: e_1_1 }; }
                        finally {
                            try {
                                if (packedVertexAttributes_1_1 && !packedVertexAttributes_1_1.done && (_a = packedVertexAttributes_1.return)) _a.call(packedVertexAttributes_1);
                            }
                            finally { if (e_1) throw e_1.error; }
                        }
                        util_1.assert((packedDataOffs - packedDataOffs_) === packedVertexSize);
                    }
                }
            }
            catch (e_2_1) { e_2 = { error: e_2_1 }; }
            finally {
                try {
                    if (drawCalls_1_1 && !drawCalls_1_1.done && (_b = drawCalls_1.return)) _b.call(drawCalls_1);
                }
                finally { if (e_2) throw e_2.error; }
            }
            // Now we should have a complete shape. Onto the next!
            shapes.push({ packedData: packedData, packedVertexSize: packedVertexSize, packedVertexAttributes: packedVertexAttributes, drawCalls: drawCalls });
            shapeIdx += 0x28;
        }
        var shp1 = { shapes: shapes };
        bmd.shp1 = shp1;
        var e_2, _b, e_1, _a;
    }
    function readMAT3Chunk(bmd, buffer, chunkStart, chunkSize) {
        var view = new DataView(buffer, chunkStart, chunkSize);
        var materialCount = view.getUint16(0x08);
        var indexToMatIndexTableOffs = view.getUint16(0x10);
        var indexToMatIndexTable = [];
        for (var i = 0; i < materialCount; i++)
            indexToMatIndexTable[i] = view.getUint16(indexToMatIndexTableOffs + i * 0x02);
        var maxIndex = Math.max.apply(null, indexToMatIndexTable);
        var nameTableOffs = view.getUint32(0x14);
        var nameTable = readStringTable(buffer, chunkStart + nameTableOffs);
        var materialEntries = [];
        var materialEntryIdx = view.getUint16(0x0C);
        for (var i = 0; i < maxIndex + 1; i++) {
            var flags = view.getUint8(materialEntryIdx + 0x00);
            var cullModeIndex = view.getUint8(materialEntryIdx + 0x01);
            var numChansIndex = view.getUint8(materialEntryIdx + 0x02);
            var texGenCountIndex = view.getUint8(materialEntryIdx + 0x03);
            var tevCount = view.getUint8(materialEntryIdx + 0x04);
            // unk
            var zModeIndex = view.getUint8(materialEntryIdx + 0x06);
            // unk
            var color1_Index0 = view.getUint16(materialEntryIdx + 0x08);
            var color1_Index1 = view.getUint16(materialEntryIdx + 0x0A);
            var chanControlsIndex0 = view.getUint16(materialEntryIdx + 0x0C);
            var chanControlsIndex1 = view.getUint16(materialEntryIdx + 0x0E);
            var chanControlsIndex2 = view.getUint16(materialEntryIdx + 0x10);
            var chanControlsIndex3 = view.getUint16(materialEntryIdx + 0x12);
            var color2_Index0 = view.getUint16(materialEntryIdx + 0x14);
            var color2_Index1 = view.getUint16(materialEntryIdx + 0x16);
            // uint16_t lights[8];
            var cullMode = view.getUint32(0x18 + cullModeIndex * 0x04);
        }
    }
    function readTEX1Chunk(bmd, buffer, chunkStart, chunkSize) {
        var view = new DataView(buffer, chunkStart, chunkSize);
        var textureCount = view.getUint16(0x08);
        var textureHeaderOffs = view.getUint32(0x0C);
        var nameTableOffs = view.getUint32(0x10);
        var nameTable = readStringTable(buffer, chunkStart + nameTableOffs);
        var textures = [];
        var textureIdx = textureHeaderOffs;
        for (var i = 0; i < textureCount; i++) {
            var name_1 = nameTable[i];
            var format = view.getUint8(textureIdx + 0x00);
            var width = view.getUint16(textureIdx + 0x02);
            var height = view.getUint16(textureIdx + 0x04);
            var wrapS = !!view.getUint8(textureIdx + 0x06);
            var wrapT = !!view.getUint8(textureIdx + 0x07);
            var paletteFormat = view.getUint8(textureIdx + 0x09);
            var paletteNumEntries = view.getUint16(textureIdx + 0x0A);
            var paletteOffs = view.getUint16(textureIdx + 0x0C);
            var minFilter = view.getUint8(textureIdx + 0x14);
            var magFilter = view.getUint8(textureIdx + 0x15);
            var mipCount = view.getUint16(textureIdx + 0x18);
            var dataOffs = view.getUint32(textureIdx + 0x1C);
            // TODO(jstpierre): WEBGL_compressed_texture_s3tc
            var supportsS3TC = false;
            var data = buffer.slice(textureIdx + dataOffs);
            var decodedTexture = Texture.decodeTexture({ format: format, width: width, height: height, data: data }, false);
            textures.push({ name: name_1, format: format, width: width, height: height, wrapS: wrapS, wrapT: wrapT, minFilter: minFilter, magFilter: magFilter, decodedTexture: decodedTexture });
            textureIdx += 0x20;
        }
        bmd.tex1 = { textures: textures };
    }
    exports_6("readTEX1Chunk", readTEX1Chunk);
    function parse(buffer) {
        var bmd = new BMD();
        var view = new DataView(buffer);
        var magic = readString(buffer, 0, 8);
        util_1.assert(magic === 'J3D2bmd3' || magic === 'J3D2bdl4');
        var size = view.getUint32(0x08);
        var numChunks = view.getUint32(0x0C);
        var offs = 0x20;
        var parseFuncs = {
            INF1: readINF1Chunk,
            VTX1: readVTX1Chunk,
            EVP1: null,
            DRW1: null,
            JNT1: null,
            SHP1: readSHP1Chunk,
            MAT3: readMAT3Chunk,
            TEX1: readTEX1Chunk,
        };
        for (var i = 0; i < numChunks; i++) {
            var chunkStart = offs;
            var chunkId = readString(buffer, chunkStart + 0x00, 4);
            var chunkSize = view.getUint32(chunkStart + 0x04);
            var parseFunc = parseFuncs[chunkId];
            if (parseFunc === undefined)
                throw new Error("Unknown chunk " + chunkId + "!");
            if (parseFunc !== null)
                parseFunc(bmd, buffer, chunkStart, chunkSize);
            offs += chunkSize;
        }
        return bmd;
    }
    exports_6("parse", parse);
    var GX, Texture, util_1, HierarchyType, BMD;
    return {
        setters: [
            function (GX_2) {
                GX = GX_2;
            },
            function (Texture_1) {
                Texture = Texture_1;
            },
            function (util_1_1) {
                util_1 = util_1_1;
            }
        ],
        execute: function () {
            (function (HierarchyType) {
                HierarchyType[HierarchyType["End"] = 0] = "End";
                HierarchyType[HierarchyType["Open"] = 1] = "Open";
                HierarchyType[HierarchyType["Close"] = 2] = "Close";
                HierarchyType[HierarchyType["Joint"] = 16] = "Joint";
                HierarchyType[HierarchyType["Material"] = 17] = "Material";
                HierarchyType[HierarchyType["Shape"] = 18] = "Shape";
            })(HierarchyType || (HierarchyType = {}));
            exports_6("HierarchyType", HierarchyType);
            BMD = /** @class */ (function () {
                function BMD() {
                }
                return BMD;
            }());
            exports_6("BMD", BMD);
        }
    };
});
System.register("j3d/render", ["j3d/bmd", "j3d/gx", "viewer", "util"], function (exports_7, context_7) {
    "use strict";
    var __moduleName = context_7 && context_7.id;
    function translateCompType(gl, compType) {
        switch (compType) {
            case GX.CompType.F32:
                return gl.FLOAT;
            case GX.CompType.S8:
                return gl.BYTE;
            case GX.CompType.S16:
                return gl.SHORT;
            case GX.CompType.U16:
                return gl.UNSIGNED_SHORT;
            case GX.CompType.U8:
                return gl.UNSIGNED_BYTE;
            case GX.CompType.RGBA8:// XXX: Is this right?
                return gl.UNSIGNED_BYTE;
            default:
                throw new Error("Unknown CompType " + compType);
        }
    }
    function translatePrimType(gl, primType) {
        switch (primType) {
            case GX.PrimitiveType.TRIANGLESTRIP:
                return gl.TRIANGLE_STRIP;
            case GX.PrimitiveType.TRIANGLEFAN:
                return gl.TRIANGLE_FAN;
            default:
                throw new Error("Unknown PrimType " + primType);
        }
    }
    var BMD, GX, Viewer, util_2, BLACK_VERT_SHADER_SOURCE, BLACK_FRAG_SHADER_SOURCE, BlackProgram, Command_Shape, Scene, SceneDesc;
    return {
        setters: [
            function (BMD_1) {
                BMD = BMD_1;
            },
            function (GX_3) {
                GX = GX_3;
            },
            function (Viewer_1) {
                Viewer = Viewer_1;
            },
            function (util_2_1) {
                util_2 = util_2_1;
            }
        ],
        execute: function () {
            BLACK_VERT_SHADER_SOURCE = "\nprecision mediump float;\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\nattribute vec3 a_position;\n\nvoid main() {\n    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n}\n";
            BLACK_FRAG_SHADER_SOURCE = "\nprecision mediump float;\n\nvoid main() {\n    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);\n}\n";
            BlackProgram = /** @class */ (function (_super) {
                __extends(BlackProgram, _super);
                function BlackProgram() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = BLACK_VERT_SHADER_SOURCE;
                    _this.frag = BLACK_FRAG_SHADER_SOURCE;
                    return _this;
                }
                BlackProgram.prototype.getAttribLocation = function (vtxAttrib) {
                    switch (vtxAttrib) {
                        case GX.VertexAttribute.POS:
                            return this.positionLocation;
                    }
                    return null;
                };
                BlackProgram.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return BlackProgram;
            }(Viewer.Program));
            Command_Shape = /** @class */ (function () {
                function Command_Shape(gl, bmd, shape) {
                    this.bmd = bmd;
                    this.shape = shape;
                    this.buffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                    gl.bufferData(gl.ARRAY_BUFFER, this.shape.packedData, gl.STATIC_DRAW);
                    console.log(new Uint8Array(this.shape.packedData));
                }
                Command_Shape.prototype.exec = function (state) {
                    var gl = state.gl;
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
                    var program = state.currentProgram;
                    try {
                        // Set up vertex attributes.
                        for (var _a = __values(this.shape.packedVertexAttributes), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var attrib = _b.value;
                            var attribLocation = program.getAttribLocation(attrib.vtxAttrib);
                            if (attribLocation === null)
                                continue; // XXX(jstpierre)
                            gl.enableVertexAttribArray(attribLocation);
                            var vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);
                            gl.vertexAttribPointer(attribLocation, vertexArray.compSize, translateCompType(gl, vertexArray.compType), false, this.shape.packedVertexSize, attrib.offset);
                        }
                    }
                    catch (e_3_1) { e_3 = { error: e_3_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_3) throw e_3.error; }
                    }
                    try {
                        // Do draw calls.
                        for (var _d = __values(this.shape.drawCalls), _e = _d.next(); !_e.done; _e = _d.next()) {
                            var drawCall = _e.value;
                            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
                        }
                    }
                    catch (e_4_1) { e_4 = { error: e_4_1 }; }
                    finally {
                        try {
                            if (_e && !_e.done && (_f = _d.return)) _f.call(_d);
                        }
                        finally { if (e_4) throw e_4.error; }
                    }
                    try {
                        for (var _g = __values(this.shape.packedVertexAttributes), _h = _g.next(); !_h.done; _h = _g.next()) {
                            var attrib = _h.value;
                            var attribLocation = program.getAttribLocation(attrib.vtxAttrib);
                            if (attribLocation === null)
                                continue; // XXX(jstpierre)
                            gl.disableVertexAttribArray(attribLocation);
                        }
                    }
                    catch (e_5_1) { e_5 = { error: e_5_1 }; }
                    finally {
                        try {
                            if (_h && !_h.done && (_j = _g.return)) _j.call(_g);
                        }
                        finally { if (e_5) throw e_5.error; }
                    }
                    var e_3, _c, e_4, _f, e_5, _j;
                };
                return Command_Shape;
            }());
            Scene = /** @class */ (function () {
                function Scene(gl, bmd) {
                    this.cameraController = Viewer.FPSCameraController;
                    this.gl = gl;
                    this.program_Black = new BlackProgram();
                    this.bmd = bmd;
                    this.translateModel(this.bmd);
                }
                Scene.prototype.render = function (state) {
                    state.useProgram(this.program_Black);
                    try {
                        for (var _a = __values(this.commands), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var command = _b.value;
                            command.exec(state);
                        }
                    }
                    catch (e_6_1) { e_6 = { error: e_6_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_6) throw e_6.error; }
                    }
                    var e_6, _c;
                };
                Scene.prototype.translateModel = function (bmd) {
                    this.commands = [];
                    // Iterate through scene graph.
                    this.translateSceneGraph(bmd.inf1.sceneGraph);
                };
                Scene.prototype.translateSceneGraph = function (node) {
                    switch (node.type) {
                        case BMD.HierarchyType.Open:
                            try {
                                for (var _a = __values(node.children), _b = _a.next(); !_b.done; _b = _a.next()) {
                                    var child = _b.value;
                                    this.translateSceneGraph(child);
                                }
                            }
                            catch (e_7_1) { e_7 = { error: e_7_1 }; }
                            finally {
                                try {
                                    if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                                }
                                finally { if (e_7) throw e_7.error; }
                            }
                            break;
                        case BMD.HierarchyType.Shape:
                            var shape = this.bmd.shp1.shapes[node.shapeIdx];
                            this.commands.push(new Command_Shape(this.gl, this.bmd, shape));
                            break;
                        case BMD.HierarchyType.Joint:
                            // XXX: Implement joints...
                            break;
                        case BMD.HierarchyType.Material:
                            // XXX: Implement materials...
                            break;
                    }
                    var e_7, _c;
                };
                return Scene;
            }());
            exports_7("Scene", Scene);
            SceneDesc = /** @class */ (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                    this.id = this.path;
                }
                SceneDesc.prototype.createScene = function (gl) {
                    return util_2.fetch(this.path).then(function (result) {
                        var bmd = BMD.parse(result);
                        return new Scene(gl, bmd);
                    });
                };
                return SceneDesc;
            }());
            exports_7("SceneDesc", SceneDesc);
        }
    };
});
System.register("j3d/scenes", ["j3d/render"], function (exports_8, context_8) {
    "use strict";
    var __moduleName = context_8 && context_8.id;
    var render_1, id, name, sceneDescs, sceneGroup;
    return {
        setters: [
            function (render_1_1) {
                render_1 = render_1_1;
            }
        ],
        execute: function () {
            id = "j3d";
            name = "J3D Models";
            sceneDescs = [
                { name: "Faceship", filename: "faceship.bmd" },
            ].map(function (entry) {
                var path = "data/j3d/" + entry.filename;
                var name = entry.name || entry.filename;
                return new render_1.SceneDesc(name, path);
            });
            exports_8("sceneGroup", sceneGroup = { id: id, name: name, sceneDescs: sceneDescs });
        }
    };
});
System.register("mdl0/mdl0", ["util"], function (exports_9, context_9) {
    "use strict";
    var __moduleName = context_9 && context_9.id;
    function readString(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var S = '';
        for (var i = 0; i < length; i++) {
            S += String.fromCharCode(buf[i]);
        }
        return S;
    }
    function parse(buffer) {
        var Flag = {
            HAS_NORMAL: 0x01,
            HAS_UV: 0x02,
            HAS_COLOR: 0x04,
        };
        var view = new DataView(buffer);
        util_3.assert(readString(buffer, 0, 4) === 'MDL\0');
        var flags = view.getUint8(0x04);
        var primType = view.getUint8(0x05);
        var vertCount = view.getUint16(0x06, true);
        var animCount = view.getUint16(0x08, true);
        var offs = 0x0A;
        if (flags & Flag.HAS_UV) {
            // XXX: How to parse UV?
            var start = offs;
            var end = start + vertCount * 8;
            offs = end;
        }
        var clrData;
        if (flags & Flag.HAS_COLOR) {
            var start = offs;
            var end = start + vertCount * 4;
            clrData = new Uint8Array(buffer.slice(start, end));
            offs = end;
        }
        else {
            clrData = new Uint8Array(vertCount * 4);
        }
        // Read in index buffer.
        var idxCount = view.getUint16(offs, true);
        var idxData;
        {
            var start = offs + 0x02;
            var end = start + (idxCount * 0x02);
            var idxArr = new Uint16Array(buffer.slice(start, end));
            if (primType === 3) {
                idxData = idxArr;
            }
            else if (primType === 4) {
                idxCount = (idxCount / 4 * 6);
                idxData = new Uint16Array(idxCount);
                for (var i = 0, j = 0; i < idxCount; i += 6) {
                    idxData[i + 0] = idxArr[j + 0];
                    idxData[i + 1] = idxArr[j + 1];
                    idxData[i + 2] = idxArr[j + 2];
                    idxData[i + 3] = idxArr[j + 2];
                    idxData[i + 4] = idxArr[j + 3];
                    idxData[i + 5] = idxArr[j + 0];
                    j += 4;
                }
            }
            offs = end;
        }
        var vtxData;
        var vertSize = 4 * (3 + ((flags & Flag.HAS_NORMAL) ? 3 : 0));
        var animSize = vertCount * vertSize;
        {
            var start = offs;
            var end = start + animCount * animSize;
            vtxData = new Uint16Array(buffer.slice(start, end));
            offs = end;
        }
        util_3.assert(offs === buffer.byteLength);
        return { clrData: clrData, idxData: idxData, vtxData: vtxData, animCount: animCount, animSize: animSize, vertCount: vertCount, vertSize: vertSize };
    }
    exports_9("parse", parse);
    var util_3;
    return {
        setters: [
            function (util_3_1) {
                util_3 = util_3_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("mdl0/render", ["mdl0/mdl0", "viewer", "util"], function (exports_10, context_10) {
    "use strict";
    var __moduleName = context_10 && context_10.id;
    var MDL0, Viewer, util_4, FancyGrid_Program, FancyGrid, MDL0_Program, Scene, SceneDesc;
    return {
        setters: [
            function (MDL0_1) {
                MDL0 = MDL0_1;
            },
            function (Viewer_2) {
                Viewer = Viewer_2;
            },
            function (util_4_1) {
                util_4 = util_4_1;
            }
        ],
        execute: function () {
            FancyGrid_Program = /** @class */ (function (_super) {
                __extends(FancyGrid_Program, _super);
                function FancyGrid_Program() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nprecision mediump float;\n\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\n\nattribute vec3 a_position;\nvarying float v_eyeFade;\nvarying vec2 v_surfCoord;\n\nvoid main() {\n    v_surfCoord = a_position.xz;\n\n    float scale = 200.0;\n    gl_Position = u_projection * u_modelView * vec4(a_position * scale, 1.0);\n\n    vec3 V = (vec4(0.0, 0.0, 1.0, 0.0) * u_modelView).xyz;\n    vec3 N = vec3(0.0, 1.0, 0.0);\n    v_eyeFade = dot(V, N);\n}\n";
                    _this.frag = "\n#extension GL_EXT_frag_depth : enable\n#extension GL_OES_standard_derivatives : enable\n\nprecision highp float;\nvarying float v_eyeFade;\nvarying vec2 v_surfCoord;\n\nvoid main() {\n    float distFromCenter = distance(v_surfCoord, vec2(0.0));\n    vec2 uv = (v_surfCoord + 1.0) * 0.5;\n\n    vec4 color;\n    color.a = 1.0;\n\n    // Base Grid color.\n    color.rgb = mix(vec3(0.8, 0.0, 0.8), vec3(0.4, 0.2, 0.8), clamp(distFromCenter * 1.5, 0.0, 1.0));\n    color.a *= clamp(mix(2.0, 0.0, distFromCenter), 0.0, 1.0);\n\n    // Grid lines mask.\n    uv *= 80.0;\n    float sharpDx = clamp(1.0 / min(abs(dFdx(uv.x)), abs(dFdy(uv.y))), 2.0, 20.0);\n    float sharpMult = sharpDx * 10.0;\n    float sharpOffs = sharpDx * 4.40;\n    vec2 gridM = (abs(fract(uv) - 0.5)) * sharpMult - sharpOffs;\n    float gridMask = max(gridM.x, gridM.y);\n    color.a *= clamp(gridMask, 0.0, 1.0);\n\n    color.a += (1.0 - clamp(distFromCenter * 1.2, 0.0, 1.0)) * 0.5 * v_eyeFade;\n\n    // Eye fade.\n    color.a *= clamp(v_eyeFade, 0.3, 1.0);\n    gl_FragColor = color;\n\n    gl_FragDepthEXT = gl_FragCoord.z + 1e-6;\n}\n";
                    return _this;
                }
                FancyGrid_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return FancyGrid_Program;
            }(Viewer.Program));
            FancyGrid = /** @class */ (function () {
                function FancyGrid(gl) {
                    this.program = new FancyGrid_Program();
                    this._createBuffers(gl);
                }
                FancyGrid.prototype.render = function (state) {
                    var gl = state.viewport.gl;
                    state.useProgram(this.program);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
                    gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, 0, 0);
                    gl.enableVertexAttribArray(this.program.positionLocation);
                    gl.enable(gl.BLEND);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                    gl.disable(gl.BLEND);
                };
                FancyGrid.prototype._createBuffers = function (gl) {
                    this.vtxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
                    var vtx = new Float32Array(4 * 3);
                    vtx[0] = -1;
                    vtx[1] = 0;
                    vtx[2] = -1;
                    vtx[3] = 1;
                    vtx[4] = 0;
                    vtx[5] = -1;
                    vtx[6] = -1;
                    vtx[7] = 0;
                    vtx[8] = 1;
                    vtx[9] = 1;
                    vtx[10] = 0;
                    vtx[11] = 1;
                    gl.bufferData(gl.ARRAY_BUFFER, vtx, gl.STATIC_DRAW);
                };
                return FancyGrid;
            }());
            MDL0_Program = /** @class */ (function (_super) {
                __extends(MDL0_Program, _super);
                function MDL0_Program() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nprecision mediump float;\n\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\n\nattribute vec3 a_position;\nattribute vec4 a_color;\nvarying vec4 v_color;\n\nvoid main() {\n    v_color = a_color.bgra;\n    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n}\n";
                    _this.frag = "\nprecision mediump float;\n\nvarying vec4 v_color;\n\nvoid main() {\n    gl_FragColor = v_color;\n}\n";
                    return _this;
                }
                MDL0_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.colorLocation = gl.getAttribLocation(prog, "a_color");
                };
                return MDL0_Program;
            }(Viewer.Program));
            Scene = /** @class */ (function () {
                function Scene(gl, mdl0) {
                    this.cameraController = Viewer.OrbitCameraController;
                    this.textures = [];
                    this.fancyGrid = new FancyGrid(gl);
                    this.program = new MDL0_Program();
                    this.mdl0 = mdl0;
                    this._createBuffers(gl);
                }
                Scene.prototype.render = function (state) {
                    var gl = state.viewport.gl;
                    state.useProgram(this.program);
                    gl.enable(gl.DEPTH_TEST);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.clrBuffer);
                    gl.vertexAttribPointer(this.program.colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);
                    gl.enableVertexAttribArray(this.program.colorLocation);
                    var frameNumber = ((state.time / 16) % this.mdl0.animCount) | 0;
                    var vtxOffset = frameNumber * this.mdl0.animSize;
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
                    gl.vertexAttribPointer(this.program.positionLocation, 3, gl.FLOAT, false, this.mdl0.vertSize, vtxOffset);
                    gl.enableVertexAttribArray(this.program.positionLocation);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);
                    gl.drawElements(gl.TRIANGLES, this.mdl0.idxData.length, gl.UNSIGNED_SHORT, 0);
                    this.fancyGrid.render(state);
                };
                Scene.prototype._createBuffers = function (gl) {
                    this.clrBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.clrBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.clrData, gl.STATIC_DRAW);
                    this.idxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.mdl0.idxData, gl.STATIC_DRAW);
                    this.vtxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.vtxBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, this.mdl0.vtxData, gl.STATIC_DRAW);
                };
                return Scene;
            }());
            SceneDesc = /** @class */ (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                    this.id = this.path;
                }
                SceneDesc.prototype.createScene = function (gl) {
                    return util_4.fetch(this.path).then(function (result) {
                        var mdl0 = MDL0.parse(result);
                        return new Scene(gl, mdl0);
                    });
                };
                return SceneDesc;
            }());
            exports_10("SceneDesc", SceneDesc);
        }
    };
});
System.register("mdl0/scenes", ["mdl0/render"], function (exports_11, context_11) {
    "use strict";
    var __moduleName = context_11 && context_11.id;
    var render_2, name, id, sceneDescs, sceneGroup;
    return {
        setters: [
            function (render_2_1) {
                render_2 = render_2_1;
            }
        ],
        execute: function () {
            name = "Sonic Mania";
            id = "mdl0";
            sceneDescs = [
                'Meshes/Continue/Count0.bin',
                'Meshes/Continue/Count1.bin',
                'Meshes/Continue/Count2.bin',
                'Meshes/Continue/Count3.bin',
                'Meshes/Continue/Count4.bin',
                'Meshes/Continue/Count5.bin',
                'Meshes/Continue/Count6.bin',
                'Meshes/Continue/Count7.bin',
                'Meshes/Continue/Count8.bin',
                'Meshes/Continue/Count9.bin',
                'Meshes/Decoration/Bird.bin',
                'Meshes/Decoration/Fish.bin',
                'Meshes/Decoration/Flower1.bin',
                'Meshes/Decoration/Flower2.bin',
                'Meshes/Decoration/Flower3.bin',
                'Meshes/Decoration/Pillar1.bin',
                'Meshes/Decoration/Pillar2.bin',
                'Meshes/Decoration/Tree.bin',
                'Meshes/Global/Sonic.bin',
                'Meshes/Global/SpecialRing.bin',
                'Meshes/Special/EmeraldBlue.bin',
                'Meshes/Special/EmeraldCyan.bin',
                'Meshes/Special/EmeraldGreen.bin',
                'Meshes/Special/EmeraldGrey.bin',
                'Meshes/Special/EmeraldPurple.bin',
                'Meshes/Special/EmeraldRed.bin',
                'Meshes/Special/EmeraldYellow.bin',
                'Meshes/Special/ItemBox.bin',
                'Meshes/Special/KnuxBall.bin',
                'Meshes/Special/KnuxDash.bin',
                'Meshes/Special/KnuxJog.bin',
                'Meshes/Special/KnuxJump.bin',
                'Meshes/Special/KnuxTumble.bin',
                'Meshes/Special/Shadow.bin',
                'Meshes/Special/SonicBall.bin',
                'Meshes/Special/SonicDash.bin',
                'Meshes/Special/SonicJog.bin',
                'Meshes/Special/SonicJump.bin',
                'Meshes/Special/SonicTumble.bin',
                'Meshes/Special/Springboard.bin',
                'Meshes/Special/TailsBall.bin',
                'Meshes/Special/TailsDash.bin',
                'Meshes/Special/TailsJog.bin',
                'Meshes/Special/TailsJump.bin',
                'Meshes/Special/TailsTumble.bin',
                'Meshes/Special/UFOChase.bin',
                'Meshes/SSZ/EggTower.bin',
                'Meshes/TMZ/MonarchBG.bin',
                'Meshes/TMZ/OrbNet.bin',
            ].map(function (filename) {
                var path = "data/mdl0/" + filename;
                var name = filename;
                return new render_2.SceneDesc(name, path);
            });
            exports_11("sceneGroup", sceneGroup = { id: id, name: name, sceneDescs: sceneDescs });
        }
    };
});
System.register("oot3d/cmb", ["util"], function (exports_12, context_12) {
    "use strict";
    var __moduleName = context_12 && context_12.id;
    function readMatsChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'mats');
        var count = view.getUint32(0x08, true);
        var offs = 0x0C;
        for (var i = 0; i < count; i++) {
            var mat = new Material();
            var bindingOffs = offs + 0x10;
            for (var j = 0; j < 3; j++) {
                var binding = new TextureBinding();
                binding.textureIdx = view.getInt16(bindingOffs + 0x00, true);
                binding.minFilter = view.getUint16(bindingOffs + 0x04, true);
                binding.magFilter = view.getUint16(bindingOffs + 0x06, true);
                binding.wrapS = view.getUint16(bindingOffs + 0x08, true);
                binding.wrapT = view.getUint16(bindingOffs + 0x0A, true);
                mat.textureBindings.push(binding);
                bindingOffs += 0x18;
            }
            mat.alphaTestEnable = !!view.getUint8(offs + 0x130);
            cmb.materials.push(mat);
            offs += 0x15C;
        }
    }
    function expand4to8(n) {
        return (n << 4) | n;
    }
    function expand5to8(n) {
        return (n << (8 - 5)) | (n >>> (10 - 8));
    }
    function expand6to8(n) {
        return (n << (8 - 6)) | (n >>> (12 - 8));
    }
    function decodeTexture_ETC1_4x4_Color(dst, w1, w2, dstOffs, stride) {
        // w1 = Upper 32-bit word, "control" data
        // w2 = Lower 32-bit word, "pixel" data
        // Table 3.17.2 -- Intensity tables for each codeword.
        var intensityTableMap = [
            [-8, -2, 2, 8],
            [-17, -5, 5, 17],
            [-29, -9, 9, 29],
            [-42, -13, 13, 42],
            [-60, -18, 18, 60],
            [-80, -24, 24, 80],
            [-106, -33, 33, 106],
            [-183, -47, 48, 183],
        ];
        // Table 3.17.3 -- MSB/LSB colors to modifiers.
        //
        //  msb lsb
        //  --- ---
        //   0  0   small colitive value (2nd intensity)
        //   0  1   large positive value (3rd intensity)
        //   1  0   small negative value (1st intensity)
        //   1  1   large negative value (0th intensity)
        //
        // Why the spec doesn't lay out the intensity map in this order,
        // I'll never know...
        var pixelToColorIndex = [2, 3, 1, 0];
        var diff = (w1 & 2);
        var flip = (w1 & 1);
        // Intensity tables for each block.
        var intensityIndex1 = (w1 >> 5) & 0x7;
        var intensityIndex2 = (w1 >> 2) & 0x7;
        var intensityTable1 = intensityTableMap[intensityIndex1];
        var intensityTable2 = intensityTableMap[intensityIndex2];
        function signed3(n) {
            // Sign-extend.
            return n << 29 >> 29;
        }
        function clamp(n) {
            if (n < 0)
                return 0;
            if (n > 255)
                return 255;
            return n;
        }
        // Get the color table for a given block.
        function getColors(colors, r, g, b, intensityMap) {
            for (var i = 0; i < 4; i++) {
                colors[(i * 3) + 0] = clamp(r + intensityMap[i]);
                colors[(i * 3) + 1] = clamp(g + intensityMap[i]);
                colors[(i * 3) + 2] = clamp(b + intensityMap[i]);
            }
        }
        var colors1 = new Uint8Array(3 * 4);
        var colors2 = new Uint8Array(3 * 4);
        if (diff) {
            var baseR1a = (w1 >>> 27) & 0x1F;
            var baseR2d = signed3((w1 >>> 24) & 0x07);
            var baseG1a = (w1 >>> 19) & 0x1F;
            var baseG2d = signed3((w1 >>> 16) & 0x07);
            var baseB1a = (w1 >>> 11) & 0x1F;
            var baseB2d = signed3((w1 >>> 8) & 0x07);
            var baseR1 = expand5to8(baseR1a);
            var baseR2 = expand5to8(baseR1a + baseR2d);
            var baseG1 = expand5to8(baseG1a);
            var baseG2 = expand5to8(baseG1a + baseG2d);
            var baseB1 = expand5to8(baseB1a);
            var baseB2 = expand5to8(baseB1a + baseB2d);
            getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
            getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
        }
        else {
            var baseR1 = expand4to8((w1 >>> 28) & 0x0F);
            var baseR2 = expand4to8((w1 >>> 24) & 0x0F);
            var baseG1 = expand4to8((w1 >>> 20) & 0x0F);
            var baseG2 = expand4to8((w1 >>> 16) & 0x0F);
            var baseB1 = expand4to8((w1 >>> 12) & 0x0F);
            var baseB2 = expand4to8((w1 >>> 8) & 0x0F);
            getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
            getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
        }
        // Go through each pixel and copy the color into the right spot...
        for (var i = 0; i < 16; i++) {
            var lsb = (w2 >>> i) & 0x01;
            var msb = (w2 >>> (16 + i)) & 0x01;
            var lookup = (msb << 1) | lsb;
            var colorsIndex = pixelToColorIndex[lookup];
            // Indexes march down and to the right here.
            var y = i & 0x03;
            var x = i >> 2;
            var dstIndex = dstOffs + ((y * stride) + x) * 4;
            // Whether we're in block 1 or block 2;
            var whichBlock = void 0;
            // If flipbit=0, the block is divided into two 2x4
            // subblocks side-by-side.
            if (flip === 0)
                whichBlock = x & 2;
            else
                whichBlock = y & 2;
            var colors = whichBlock ? colors2 : colors1;
            dst[dstIndex + 0] = colors[(colorsIndex * 3) + 0];
            dst[dstIndex + 1] = colors[(colorsIndex * 3) + 1];
            dst[dstIndex + 2] = colors[(colorsIndex * 3) + 2];
        }
    }
    function decodeTexture_ETC1_4x4_Alpha(dst, a1, a2, dstOffs, stride) {
        for (var ax = 0; ax < 2; ax++) {
            for (var ay = 0; ay < 4; ay++) {
                var dstIndex = dstOffs + ((ay * stride) + ax) * 4;
                dst[dstIndex + 3] = expand4to8(a2 & 0x0F);
                a2 >>= 4;
            }
        }
        for (var ax = 2; ax < 4; ax++) {
            for (var ay = 0; ay < 4; ay++) {
                var dstIndex = dstOffs + ((ay * stride) + ax) * 4;
                dst[dstIndex + 3] = expand4to8(a1 & 0x0F);
                a1 >>= 4;
            }
        }
    }
    function decodeTexture_ETC1(texture, texData, alpha) {
        var pixels = new Uint8Array(texture.width * texture.height * 4);
        var stride = texture.width;
        var src = new DataView(texData);
        var offs = 0;
        for (var yy = 0; yy < texture.height; yy += 8) {
            for (var xx = 0; xx < texture.width; xx += 8) {
                // Order of each set of 4 blocks: top left, top right, bottom left, bottom right...
                for (var y = 0; y < 8; y += 4) {
                    for (var x = 0; x < 8; x += 4) {
                        var dstOffs = ((yy + y) * stride + (xx + x)) * 4;
                        var a1 = void 0;
                        var a2 = void 0;
                        if (alpha) {
                            // In ETC1A4 mode, we have 8 bytes of per-pixel alpha data preceeding the tile.
                            a2 = src.getUint32(offs + 0x00, true);
                            a1 = src.getUint32(offs + 0x04, true);
                            offs += 0x08;
                        }
                        else {
                            a2 = 0xFFFFFFFF;
                            a1 = 0xFFFFFFFF;
                        }
                        decodeTexture_ETC1_4x4_Alpha(pixels, a1, a2, dstOffs, stride);
                        var w2 = src.getUint32(offs + 0x00, true);
                        var w1 = src.getUint32(offs + 0x04, true);
                        decodeTexture_ETC1_4x4_Color(pixels, w1, w2, dstOffs, stride);
                        offs += 0x08;
                    }
                }
            }
        }
        return pixels;
    }
    function decodeTexture_Tiled(texture, texData, decoder) {
        var pixels = new Uint8Array(texture.width * texture.height * 4);
        var stride = texture.width;
        function morton7(n) {
            // 0a0b0c => 000abc
            return ((n >> 2) & 0x04) | ((n >> 1) & 0x02) | (n & 0x01);
        }
        for (var yy = 0; yy < texture.height; yy += 8) {
            for (var xx = 0; xx < texture.width; xx += 8) {
                // Iterate in Morton order inside each tile.
                for (var i = 0; i < 0x40; i++) {
                    var x = morton7(i);
                    var y = morton7(i >> 1);
                    var dstOffs = ((yy + y) * stride + xx + x) * 4;
                    decoder(pixels, dstOffs);
                }
            }
        }
        return pixels;
    }
    function decodeTexture_RGBA5551(texture, texData) {
        var src = new DataView(texData);
        var srcOffs = 0;
        return decodeTexture_Tiled(texture, texData, function (pixels, dstOffs) {
            var p = src.getUint16(srcOffs, true);
            pixels[dstOffs + 0] = expand5to8((p >> 11) & 0x1F);
            pixels[dstOffs + 1] = expand5to8((p >> 6) & 0x1F);
            pixels[dstOffs + 2] = expand5to8((p >> 1) & 0x1F);
            pixels[dstOffs + 3] = (p & 0x01) ? 0xFF : 0x00;
            srcOffs += 2;
        });
    }
    function decodeTexture_RGB565(texture, texData) {
        var src = new DataView(texData);
        var srcOffs = 0;
        return decodeTexture_Tiled(texture, texData, function (pixels, dstOffs) {
            var p = src.getUint16(srcOffs, true);
            pixels[dstOffs + 0] = expand5to8((p >> 11) & 0x1F);
            pixels[dstOffs + 1] = expand6to8((p >> 5) & 0x3F);
            pixels[dstOffs + 2] = expand5to8(p & 0x1F);
            pixels[dstOffs + 3] = 0xFF;
            srcOffs += 2;
        });
    }
    function decodeTexture_A8(texture, texData) {
        var src = new DataView(texData);
        var srcOffs = 0;
        return decodeTexture_Tiled(texture, texData, function (pixels, dstOffs) {
            var A = src.getUint8(srcOffs++);
            pixels[dstOffs + 0] = 0xFF;
            pixels[dstOffs + 1] = 0xFF;
            pixels[dstOffs + 2] = 0xFF;
            pixels[dstOffs + 3] = A;
        });
    }
    function decodeTexture_L8(texture, texData) {
        var src = new DataView(texData);
        var srcOffs = 0;
        return decodeTexture_Tiled(texture, texData, function (pixels, dstOffs) {
            var L = src.getUint8(srcOffs++);
            pixels[dstOffs + 0] = L;
            pixels[dstOffs + 1] = L;
            pixels[dstOffs + 2] = L;
            pixels[dstOffs + 3] = L;
        });
    }
    function decodeTexture_LA8(texture, texData) {
        var src = new DataView(texData);
        var srcOffs = 0;
        return decodeTexture_Tiled(texture, texData, function (pixels, dstOffs) {
            var L = src.getUint8(srcOffs++);
            var A = src.getUint8(srcOffs++);
            pixels[dstOffs + 0] = L;
            pixels[dstOffs + 1] = L;
            pixels[dstOffs + 2] = L;
            pixels[dstOffs + 3] = A;
        });
    }
    function decodeTexture(texture, texData) {
        switch (texture.format) {
            case TextureFormat.ETC1:
                return decodeTexture_ETC1(texture, texData, false);
            case TextureFormat.ETC1A4:
                return decodeTexture_ETC1(texture, texData, true);
            case TextureFormat.RGBA5551:
                return decodeTexture_RGBA5551(texture, texData);
            case TextureFormat.RGB565:
                return decodeTexture_RGB565(texture, texData);
            case TextureFormat.A8:
                return decodeTexture_A8(texture, texData);
            case TextureFormat.L8:
                return decodeTexture_L8(texture, texData);
            case TextureFormat.LA8:
                return decodeTexture_LA8(texture, texData);
            default:
                throw new Error("Unsupported texture type! " + texture.format);
        }
    }
    function readTexChunk(cmb, buffer, texData) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'tex ');
        var count = view.getUint32(0x08, true);
        var offs = 0x0C;
        for (var i = 0; i < count; i++) {
            var texture = new Texture();
            var size = view.getUint32(offs + 0x00, true);
            texture.width = view.getUint16(offs + 0x08, true);
            texture.height = view.getUint16(offs + 0x0A, true);
            texture.format = view.getUint32(offs + 0x0C, true);
            var dataOffs = view.getUint32(offs + 0x10, true);
            texture.name = util_5.readString(buffer, offs + 0x14, 0x10);
            texture.name = texture.name + "  (" + texture.format + ")";
            offs += 0x24;
            texture.pixels = decodeTexture(texture, texData.slice(dataOffs, dataOffs + size));
            cmb.textures.push(texture);
        }
    }
    function readVatrChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'vatr');
        cmb.vertexBufferSlices = new VertexBufferSlices();
        var posSize = view.getUint32(0x0C, true);
        var posOffs = view.getUint32(0x10, true);
        cmb.vertexBufferSlices.posBuffer = buffer.slice(posOffs, posOffs + posSize);
        var nrmSize = view.getUint32(0x14, true);
        var nrmOffs = view.getUint32(0x18, true);
        cmb.vertexBufferSlices.nrmBuffer = buffer.slice(nrmOffs, nrmOffs + nrmSize);
        var colSize = view.getUint32(0x1C, true);
        var colOffs = view.getUint32(0x20, true);
        cmb.vertexBufferSlices.colBuffer = buffer.slice(colOffs, colOffs + colSize);
        var txcSize = view.getUint32(0x24, true);
        var txcOffs = view.getUint32(0x28, true);
        cmb.vertexBufferSlices.txcBuffer = buffer.slice(txcOffs, txcOffs + txcSize);
    }
    function readMshsChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'mshs');
        var count = view.getUint32(0x08, true);
        var offs = 0x10;
        for (var i = 0; i < count; i++) {
            var mesh = new Mesh();
            mesh.sepdIdx = view.getUint16(offs, true);
            mesh.matsIdx = view.getUint8(offs + 2);
            cmb.meshs.push(mesh);
            offs += 0x04;
        }
    }
    function readPrmChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'prm ');
        var prm = new Prm();
        prm.indexType = view.getUint32(0x10, true);
        prm.count = view.getUint16(0x14, true);
        prm.offset = view.getUint16(0x16, true);
        return prm;
    }
    function readPrmsChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'prms');
        var prmOffs = view.getUint32(0x14, true);
        return readPrmChunk(cmb, buffer.slice(prmOffs));
    }
    function readSepdChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'sepd');
        var count = view.getUint16(0x08, true);
        var sepd = new Sepd();
        var offs = 0x108;
        for (var i = 0; i < count; i++) {
            var prmsOffs = view.getUint32(offs, true);
            sepd.prms.push(readPrmsChunk(cmb, buffer.slice(prmsOffs)));
            offs += 0x02;
        }
        sepd.posStart = view.getUint32(0x24, true);
        sepd.posScale = view.getFloat32(0x28, true);
        sepd.posType = view.getUint16(0x2C, true);
        sepd.nrmStart = view.getUint32(0x40, true);
        sepd.nrmScale = view.getFloat32(0x44, true);
        sepd.nrmType = view.getUint16(0x48, true);
        sepd.colStart = view.getUint32(0x5C, true);
        sepd.colScale = view.getFloat32(0x60, true);
        sepd.colType = view.getUint16(0x64, true);
        sepd.txcStart = view.getUint32(0x78, true);
        sepd.txcScale = view.getFloat32(0x7C, true);
        sepd.txcType = view.getUint16(0x80, true);
        return sepd;
    }
    function readShpChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'shp ');
        var count = view.getUint32(0x08, true);
        var offs = 0x10;
        for (var i = 0; i < count; i++) {
            var sepdOffs = view.getUint16(offs, true);
            var sepd = readSepdChunk(cmb, buffer.slice(sepdOffs));
            cmb.sepds.push(sepd);
            offs += 0x02;
        }
    }
    function readSklmChunk(cmb, buffer) {
        var view = new DataView(buffer);
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'sklm');
        var mshsChunkOffs = view.getUint32(0x08, true);
        readMshsChunk(cmb, buffer.slice(mshsChunkOffs));
        var shpChunkOffs = view.getUint32(0x0C, true);
        readShpChunk(cmb, buffer.slice(shpChunkOffs));
    }
    function parse(buffer) {
        var view = new DataView(buffer);
        var cmb = new CMB();
        util_5.assert(util_5.readString(buffer, 0x00, 0x04) === 'cmb ');
        var size = view.getUint32(0x04, true);
        cmb.name = util_5.readString(buffer, 0x10, 0x10);
        var matsChunkOffs = view.getUint32(0x28, true);
        readMatsChunk(cmb, buffer.slice(matsChunkOffs));
        var texDataOffs = view.getUint32(0x40, true);
        var texChunkOffs = view.getUint32(0x2C, true);
        readTexChunk(cmb, buffer.slice(texChunkOffs), buffer.slice(texDataOffs));
        var vatrChunkOffs = view.getUint32(0x38, true);
        readVatrChunk(cmb, buffer.slice(vatrChunkOffs));
        var sklmChunkOffs = view.getUint32(0x30, true);
        readSklmChunk(cmb, buffer.slice(sklmChunkOffs));
        var idxDataOffs = view.getUint32(0x3C, true);
        var idxDataCount = view.getUint32(0x20, true);
        cmb.indexBuffer = buffer.slice(idxDataOffs, idxDataOffs + idxDataCount * 2);
        return cmb;
    }
    exports_12("parse", parse);
    var util_5, VertexBufferSlices, CMB, TextureFilter, TextureWrapMode, TextureBinding, Material, TextureFormat, Texture, Mesh, DataType, Prm, Sepd;
    return {
        setters: [
            function (util_5_1) {
                util_5 = util_5_1;
            }
        ],
        execute: function () {
            VertexBufferSlices = /** @class */ (function () {
                function VertexBufferSlices() {
                }
                return VertexBufferSlices;
            }());
            CMB = /** @class */ (function () {
                function CMB() {
                    this.textures = [];
                    this.materials = [];
                    this.sepds = [];
                    this.meshs = [];
                }
                return CMB;
            }());
            exports_12("CMB", CMB);
            (function (TextureFilter) {
                TextureFilter[TextureFilter["NEAREST"] = 9728] = "NEAREST";
                TextureFilter[TextureFilter["LINEAR"] = 9729] = "LINEAR";
                TextureFilter[TextureFilter["NEAREST_MIPMAP_NEAREST"] = 9984] = "NEAREST_MIPMAP_NEAREST";
                TextureFilter[TextureFilter["LINEAR_MIPMAP_NEAREST"] = 9985] = "LINEAR_MIPMAP_NEAREST";
                TextureFilter[TextureFilter["NEAREST_MIPMIP_LINEAR"] = 9986] = "NEAREST_MIPMIP_LINEAR";
                TextureFilter[TextureFilter["LINEAR_MIPMAP_LINEAR"] = 9987] = "LINEAR_MIPMAP_LINEAR";
            })(TextureFilter || (TextureFilter = {}));
            exports_12("TextureFilter", TextureFilter);
            (function (TextureWrapMode) {
                TextureWrapMode[TextureWrapMode["CLAMP"] = 10496] = "CLAMP";
                TextureWrapMode[TextureWrapMode["REPEAT"] = 10497] = "REPEAT";
            })(TextureWrapMode || (TextureWrapMode = {}));
            exports_12("TextureWrapMode", TextureWrapMode);
            TextureBinding = /** @class */ (function () {
                function TextureBinding() {
                }
                return TextureBinding;
            }());
            Material = /** @class */ (function () {
                function Material() {
                    this.textureBindings = [];
                }
                return Material;
            }());
            exports_12("Material", Material);
            (function (TextureFormat) {
                TextureFormat[TextureFormat["ETC1"] = 26458] = "ETC1";
                TextureFormat[TextureFormat["ETC1A4"] = 26459] = "ETC1A4";
                TextureFormat[TextureFormat["RGBA5551"] = 2150917970] = "RGBA5551";
                TextureFormat[TextureFormat["RGB565"] = 2204329812] = "RGB565";
                TextureFormat[TextureFormat["A8"] = 335636310] = "A8";
                TextureFormat[TextureFormat["L8"] = 335636311] = "L8";
                TextureFormat[TextureFormat["LA8"] = 335636312] = "LA8";
            })(TextureFormat || (TextureFormat = {}));
            Texture = /** @class */ (function () {
                function Texture() {
                }
                return Texture;
            }());
            exports_12("Texture", Texture);
            Mesh = /** @class */ (function () {
                function Mesh() {
                }
                return Mesh;
            }());
            exports_12("Mesh", Mesh);
            (function (DataType) {
                DataType[DataType["Byte"] = 5120] = "Byte";
                DataType[DataType["UByte"] = 5121] = "UByte";
                DataType[DataType["Short"] = 5122] = "Short";
                DataType[DataType["UShort"] = 5123] = "UShort";
                DataType[DataType["Int"] = 5124] = "Int";
                DataType[DataType["UInt"] = 5125] = "UInt";
                DataType[DataType["Float"] = 5126] = "Float";
            })(DataType || (DataType = {}));
            exports_12("DataType", DataType);
            Prm = /** @class */ (function () {
                function Prm() {
                }
                return Prm;
            }());
            exports_12("Prm", Prm);
            Sepd = /** @class */ (function () {
                function Sepd() {
                    this.prms = [];
                }
                return Sepd;
            }());
            exports_12("Sepd", Sepd);
        }
    };
});
System.register("oot3d/zsi", ["oot3d/cmb", "util"], function (exports_13, context_13) {
    "use strict";
    var __moduleName = context_13 && context_13.id;
    function readRooms(view, nRooms, offs) {
        var rooms = [];
        for (var i = 0; i < nRooms; i++) {
            rooms.push(util_6.readString(view.buffer, offs, 0x44));
            offs += 0x44;
        }
        return rooms;
    }
    function readMesh(view, offs) {
        var mesh = new Mesh();
        var hdr = view.getUint32(offs);
        var type = (hdr >> 24);
        var nEntries = (hdr >> 16) & 0xFF;
        var entriesAddr = view.getUint32(offs + 4, true);
        util_6.assert(type === 0x02);
        util_6.assert(nEntries === 0x01);
        var opaqueAddr = view.getUint32(entriesAddr + 0x08, true);
        var transparentAddr = view.getUint32(entriesAddr + 0x0C, true);
        if (opaqueAddr !== 0)
            mesh.opaque = CMB.parse(view.buffer.slice(opaqueAddr));
        if (transparentAddr !== 0)
            mesh.transparent = CMB.parse(view.buffer.slice(transparentAddr));
        mesh.textures = [];
        if (mesh.opaque)
            mesh.textures = mesh.textures.concat(mesh.opaque.textures);
        if (mesh.transparent)
            mesh.textures = mesh.textures.concat(mesh.transparent.textures);
        return mesh;
    }
    function readCollision(view, offs) {
        var waterboxTableCount = view.getUint16(offs + 0x14, true);
        var waterboxTableOffs = view.getUint32(offs + 0x28, true);
        var waterboxes = new Uint16Array(waterboxTableCount * 3 * 4);
        var waterboxTableIdx = waterboxTableOffs;
        for (var i = 0; i < waterboxTableCount; i++) {
            var x = view.getInt16(waterboxTableIdx + 0x00, true);
            var y = view.getInt16(waterboxTableIdx + 0x02, true);
            var z = view.getInt16(waterboxTableIdx + 0x04, true);
            var sx = view.getInt16(waterboxTableIdx + 0x06, true);
            var sz = view.getInt16(waterboxTableIdx + 0x08, true);
            waterboxes[i * 3 * 4 + 0] = x;
            waterboxes[i * 3 * 4 + 1] = y;
            waterboxes[i * 3 * 4 + 2] = z;
            waterboxes[i * 3 * 4 + 3] = x + sx;
            waterboxes[i * 3 * 4 + 4] = y;
            waterboxes[i * 3 * 4 + 5] = z;
            waterboxes[i * 3 * 4 + 6] = x;
            waterboxes[i * 3 * 4 + 7] = y;
            waterboxes[i * 3 * 4 + 8] = z + sz;
            waterboxes[i * 3 * 4 + 9] = x + sx;
            waterboxes[i * 3 * 4 + 10] = y;
            waterboxes[i * 3 * 4 + 11] = z + sz;
            waterboxTableIdx += 0x10;
        }
        return { waterboxes: waterboxes };
    }
    // ZSI headers are a slight modification of the original Z64 headers.
    function readHeaders(buffer) {
        var view = new DataView(buffer);
        var offs = 0;
        var zsi = new ZSI();
        while (true) {
            var cmd1 = view.getUint32(offs, false);
            var cmd2 = view.getUint32(offs + 4, true);
            offs += 8;
            var cmdType = cmd1 >> 24;
            if (cmdType == HeaderCommands.End)
                break;
            switch (cmdType) {
                case HeaderCommands.Rooms:
                    var nRooms = (cmd1 >> 16) & 0xFF;
                    zsi.rooms = readRooms(view, nRooms, cmd2);
                    break;
                case HeaderCommands.Mesh:
                    zsi.mesh = readMesh(view, cmd2);
                    break;
                case HeaderCommands.Collision:
                    zsi.collision = readCollision(view, cmd2);
                    break;
            }
        }
        return zsi;
    }
    function parse(buffer) {
        util_6.assert(util_6.readString(buffer, 0x00, 0x04) === 'ZSI\x01');
        var name = util_6.readString(buffer, 0x04, 0x0C);
        // ZSI header is done. It's that simple! Now for the actual data.
        var headersBuf = buffer.slice(0x10);
        return readHeaders(headersBuf);
    }
    exports_13("parse", parse);
    var CMB, util_6, ZSI, HeaderCommands, Mesh;
    return {
        setters: [
            function (CMB_1) {
                CMB = CMB_1;
            },
            function (util_6_1) {
                util_6 = util_6_1;
            }
        ],
        execute: function () {
            ZSI = /** @class */ (function () {
                function ZSI() {
                }
                return ZSI;
            }());
            exports_13("ZSI", ZSI);
            // Subset of Z64 command types.
            (function (HeaderCommands) {
                HeaderCommands[HeaderCommands["Collision"] = 3] = "Collision";
                HeaderCommands[HeaderCommands["Rooms"] = 4] = "Rooms";
                HeaderCommands[HeaderCommands["Mesh"] = 10] = "Mesh";
                HeaderCommands[HeaderCommands["End"] = 20] = "End";
            })(HeaderCommands || (HeaderCommands = {}));
            Mesh = /** @class */ (function () {
                function Mesh() {
                }
                return Mesh;
            }());
            exports_13("Mesh", Mesh);
        }
    };
});
System.register("oot3d/render", ["oot3d/zsi", "oot3d/cmb", "viewer", "util"], function (exports_14, context_14) {
    "use strict";
    var __moduleName = context_14 && context_14.id;
    function textureToCanvas(texture) {
        var canvas = document.createElement("canvas");
        canvas.width = texture.width;
        canvas.height = texture.height;
        canvas.title = texture.name;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);
        for (var i = 0; i < imgData.data.length; i++)
            imgData.data[i] = texture.pixels[i];
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }
    function dirname(path) {
        var parts = path.split('/');
        parts.pop();
        return parts.join('/');
    }
    var ZSI, CMB, Viewer, util_7, OoT3D_Program, Scene, MultiScene, SceneDesc;
    return {
        setters: [
            function (ZSI_1) {
                ZSI = ZSI_1;
            },
            function (CMB_2) {
                CMB = CMB_2;
            },
            function (Viewer_3) {
                Viewer = Viewer_3;
            },
            function (util_7_1) {
                util_7 = util_7_1;
            }
        ],
        execute: function () {
            OoT3D_Program = /** @class */ (function (_super) {
                __extends(OoT3D_Program, _super);
                function OoT3D_Program() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\n    precision mediump float;\n    uniform mat4 u_modelView;\n    uniform mat4 u_localMatrix;\n    uniform mat4 u_projection;\n    uniform float u_posScale;\n    uniform float u_uvScale;\n    attribute vec3 a_position;\n    attribute vec2 a_uv;\n    attribute vec4 a_color;\n    varying vec4 v_color;\n    varying vec2 v_uv;\n\n    void main() {\n        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0) * u_posScale;\n        v_color = a_color;\n        v_uv = a_uv * u_uvScale;\n        v_uv.t = 1.0 - v_uv.t;\n    }";
                    _this.frag = "\n    precision mediump float;\n    varying vec2 v_uv;\n    varying vec4 v_color;\n    uniform sampler2D u_texture;\n    uniform bool u_alphaTest;\n    \n    void main() {\n        gl_FragColor = texture2D(u_texture, v_uv);\n        gl_FragColor *= v_color;\n        if (u_alphaTest && gl_FragColor.a <= 0.8)\n            discard;\n    }";
                    return _this;
                }
                OoT3D_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.posScaleLocation = gl.getUniformLocation(prog, "u_posScale");
                    this.uvScaleLocation = gl.getUniformLocation(prog, "u_uvScale");
                    this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.colorLocation = gl.getAttribLocation(prog, "a_color");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return OoT3D_Program;
            }(Viewer.Program));
            Scene = /** @class */ (function () {
                function Scene(gl, zsi) {
                    this.cameraController = Viewer.FPSCameraController;
                    this.program = new OoT3D_Program();
                    this.textures = zsi.mesh.textures.map(function (texture) {
                        return textureToCanvas(texture);
                    });
                    this.zsi = zsi;
                    this.model = this.translateModel(gl, zsi.mesh);
                }
                Scene.prototype.translateDataType = function (gl, dataType) {
                    switch (dataType) {
                        case CMB.DataType.Byte: return gl.BYTE;
                        case CMB.DataType.UByte: return gl.UNSIGNED_BYTE;
                        case CMB.DataType.Short: return gl.SHORT;
                        case CMB.DataType.UShort: return gl.UNSIGNED_SHORT;
                        case CMB.DataType.Int: return gl.INT;
                        case CMB.DataType.UInt: return gl.UNSIGNED_INT;
                        case CMB.DataType.Float: return gl.FLOAT;
                        default: throw new Error();
                    }
                };
                Scene.prototype.dataTypeSize = function (dataType) {
                    switch (dataType) {
                        case CMB.DataType.Byte: return 1;
                        case CMB.DataType.UByte: return 1;
                        case CMB.DataType.Short: return 2;
                        case CMB.DataType.UShort: return 2;
                        case CMB.DataType.Int: return 4;
                        case CMB.DataType.UInt: return 4;
                        case CMB.DataType.Float: return 4;
                        default: throw new Error();
                    }
                };
                Scene.prototype.translateSepd = function (gl, cmbContext, sepd) {
                    var _this = this;
                    return function () {
                        gl.uniform1f(_this.program.uvScaleLocation, sepd.txcScale);
                        gl.uniform1f(_this.program.posScaleLocation, sepd.posScale);
                        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.posBuffer);
                        gl.vertexAttribPointer(_this.program.positionLocation, 3, _this.translateDataType(gl, sepd.posType), false, 0, sepd.posStart);
                        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.colBuffer);
                        gl.vertexAttribPointer(_this.program.colorLocation, 4, _this.translateDataType(gl, sepd.colType), true, 0, sepd.colStart);
                        gl.bindBuffer(gl.ARRAY_BUFFER, cmbContext.txcBuffer);
                        gl.vertexAttribPointer(_this.program.uvLocation, 2, _this.translateDataType(gl, sepd.txcType), false, 0, sepd.txcStart);
                        gl.enableVertexAttribArray(_this.program.positionLocation);
                        gl.enableVertexAttribArray(_this.program.colorLocation);
                        gl.enableVertexAttribArray(_this.program.uvLocation);
                        try {
                            for (var _a = __values(sepd.prms), _b = _a.next(); !_b.done; _b = _a.next()) {
                                var prm = _b.value;
                                gl.drawElements(gl.TRIANGLES, prm.count, _this.translateDataType(gl, prm.indexType), prm.offset * _this.dataTypeSize(prm.indexType));
                            }
                        }
                        catch (e_8_1) { e_8 = { error: e_8_1 }; }
                        finally {
                            try {
                                if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                            }
                            finally { if (e_8) throw e_8.error; }
                        }
                        gl.disableVertexAttribArray(_this.program.positionLocation);
                        gl.disableVertexAttribArray(_this.program.colorLocation);
                        gl.disableVertexAttribArray(_this.program.uvLocation);
                        var e_8, _c;
                    };
                };
                Scene.prototype.translateTexture = function (gl, texture) {
                    var texId = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, texId);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
                    return texId;
                };
                Scene.prototype.translateMaterial = function (gl, cmbContext, material) {
                    var _this = this;
                    function translateWrapMode(wrapMode) {
                        switch (wrapMode) {
                            case CMB.TextureWrapMode.CLAMP: return gl.CLAMP_TO_EDGE;
                            case CMB.TextureWrapMode.REPEAT: return gl.REPEAT;
                            default: throw new Error();
                        }
                    }
                    function translateTextureFilter(filter) {
                        switch (filter) {
                            case CMB.TextureFilter.LINEAR: return gl.LINEAR;
                            case CMB.TextureFilter.NEAREST: return gl.NEAREST;
                            case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR: return gl.NEAREST;
                            case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST: return gl.NEAREST;
                            case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST: return gl.NEAREST;
                            case CMB.TextureFilter.NEAREST_MIPMIP_LINEAR: return gl.NEAREST;
                            default: throw new Error();
                        }
                    }
                    return function () {
                        for (var i = 0; i < 1; i++) {
                            var binding = material.textureBindings[i];
                            if (binding.textureIdx === -1)
                                continue;
                            gl.uniform1i(_this.program.alphaTestLocation, material.alphaTestEnable ? 1 : 0);
                            gl.activeTexture(gl.TEXTURE0 + i);
                            gl.bindTexture(gl.TEXTURE_2D, cmbContext.textures[binding.textureIdx]);
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, translateTextureFilter(binding.minFilter));
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, translateTextureFilter(binding.magFilter));
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, translateWrapMode(binding.wrapS));
                            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, translateWrapMode(binding.wrapT));
                        }
                    };
                };
                Scene.prototype.translateMesh = function (gl, cmbContext, mesh) {
                    var mat = cmbContext.matFuncs[mesh.matsIdx];
                    var sepd = cmbContext.sepdFuncs[mesh.sepdIdx];
                    return function () {
                        mat(mesh);
                        sepd();
                    };
                };
                Scene.prototype.translateCmb = function (gl, cmb) {
                    var _this = this;
                    if (!cmb)
                        return function () { };
                    var posBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.posBuffer, gl.STATIC_DRAW);
                    var colBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.colBuffer, gl.STATIC_DRAW);
                    var nrmBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.nrmBuffer, gl.STATIC_DRAW);
                    var txcBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, txcBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, cmb.vertexBufferSlices.txcBuffer, gl.STATIC_DRAW);
                    var textures = cmb.textures.map(function (texture) {
                        return _this.translateTexture(gl, texture);
                    });
                    var cmbContext = {
                        posBuffer: posBuffer,
                        colBuffer: colBuffer,
                        nrmBuffer: nrmBuffer,
                        txcBuffer: txcBuffer,
                        textures: textures,
                    };
                    cmbContext.sepdFuncs = cmb.sepds.map(function (sepd) { return _this.translateSepd(gl, cmbContext, sepd); });
                    cmbContext.matFuncs = cmb.materials.map(function (material) { return _this.translateMaterial(gl, cmbContext, material); });
                    var meshFuncs = cmb.meshs.map(function (mesh) { return _this.translateMesh(gl, cmbContext, mesh); });
                    var idxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cmb.indexBuffer, gl.STATIC_DRAW);
                    return function () {
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                        try {
                            for (var meshFuncs_1 = __values(meshFuncs), meshFuncs_1_1 = meshFuncs_1.next(); !meshFuncs_1_1.done; meshFuncs_1_1 = meshFuncs_1.next()) {
                                var func = meshFuncs_1_1.value;
                                func();
                            }
                        }
                        catch (e_9_1) { e_9 = { error: e_9_1 }; }
                        finally {
                            try {
                                if (meshFuncs_1_1 && !meshFuncs_1_1.done && (_a = meshFuncs_1.return)) _a.call(meshFuncs_1);
                            }
                            finally { if (e_9) throw e_9.error; }
                        }
                        var e_9, _a;
                    };
                };
                Scene.prototype.translateModel = function (gl, mesh) {
                    var opaque = this.translateCmb(gl, mesh.opaque);
                    var transparent = this.translateCmb(gl, mesh.transparent);
                    return function () {
                        opaque();
                        // transparent();
                    };
                };
                Scene.prototype.render = function (state) {
                    var gl = state.viewport.gl;
                    state.useProgram(this.program);
                    gl.enable(gl.DEPTH_TEST);
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    this.model();
                };
                return Scene;
            }());
            MultiScene = /** @class */ (function () {
                function MultiScene(scenes) {
                    this.cameraController = Viewer.FPSCameraController;
                    this.scenes = scenes;
                    this.textures = [];
                    try {
                        for (var _a = __values(this.scenes), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var scene = _b.value;
                            this.textures = this.textures.concat(scene.textures);
                        }
                    }
                    catch (e_10_1) { e_10 = { error: e_10_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_10) throw e_10.error; }
                    }
                    var e_10, _c;
                }
                MultiScene.prototype.render = function (renderState) {
                    this.scenes.forEach(function (scene) { return scene.render(renderState); });
                };
                return MultiScene;
            }());
            SceneDesc = /** @class */ (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                    this.id = this.path;
                }
                SceneDesc.prototype._createSceneFromData = function (gl, result) {
                    var _this = this;
                    var zsi = ZSI.parse(result);
                    if (zsi.mesh) {
                        return Promise.resolve(new Scene(gl, zsi));
                    }
                    else if (zsi.rooms) {
                        var basePath_1 = dirname(this.path);
                        var roomFilenames = zsi.rooms.map(function (romPath) {
                            var filename = romPath.split('/').pop();
                            return basePath_1 + '/' + filename;
                        });
                        return Promise.all(roomFilenames.map(function (filename) {
                            return util_7.fetch(filename).then(function (result) { return _this._createSceneFromData(gl, result); });
                        })).then(function (scenes) {
                            return new MultiScene(scenes);
                        });
                    }
                };
                SceneDesc.prototype.createScene = function (gl) {
                    var _this = this;
                    return util_7.fetch(this.path).then(function (result) {
                        return _this._createSceneFromData(gl, result);
                    });
                };
                return SceneDesc;
            }());
            exports_14("SceneDesc", SceneDesc);
        }
    };
});
System.register("oot3d/scenes", ["oot3d/render"], function (exports_15, context_15) {
    "use strict";
    var __moduleName = context_15 && context_15.id;
    var render_3, id, name, sceneDescs, sceneGroup;
    return {
        setters: [
            function (render_3_1) {
                render_3 = render_3_1;
            }
        ],
        execute: function () {
            id = "oot3d";
            name = "Ocarina of Time 3D";
            sceneDescs = [
                { name: "Inside the Deku Tree", filename: "ydan_info.zsi" },
                { name: "Inside the Deku Tree (Boss)", filename: "ydan_boss_info.zsi" },
                { name: "Dodongo's Cavern", filename: "ddan_info.zsi" },
                { name: "Dodongo's Cavern (Boss)", filename: "ddan_boss_info.zsi" },
                { name: "Jabu-Jabu's Belly", filename: 'bdan_info.zsi' },
                { name: "Jabu-Jabu's Belly (Boss)", filename: 'bdan_boss_info.zsi' },
                { name: "Forest Temple", filename: 'bmori1_info.zsi' },
                { name: "Forest Temple (Boss)", filename: "moriboss_info.zsi" },
                { name: "Fire Temple", filename: "hidan_info.zsi" },
                { name: "Fire Temple (Boss)", filename: "fire_bs_info.zsi" },
                { name: "Water Temple", filename: "mizusin_info.zsi" },
                { name: "Water Temple (Boss)", filename: "mizusin_boss_info.zsi" },
                { name: "Spirit Temple", filename: "jyasinzou_info.zsi" },
                { name: "Spirit Temple (Mid-Boss)", filename: "jyasinzou_boss_info.zsi" },
                { name: "Shadow Temple", filename: "hakadan_info.zsi" },
                { name: "Shadow Temple (Boss)", filename: "hakadan_boss_info.zsi" },
                { name: "Bottom of the Well", filename: "hakadan_ch_info.zsi" },
                { name: "Ice Cavern", filename: "ice_doukutu_info.zsi" },
                { name: "Gerudo Training Grounds", filename: "men_info.zsi" },
                { name: "Thieve's Hideout", filename: "gerudoway_info.zsi" },
                { name: "Ganon's Castle", filename: "ganontika_info.zsi" },
                { name: "Ganon's Castle (Crumbling)", filename: "ganontikasonogo_info.zsi" },
                { name: "Ganon's Castle (Outside)", filename: "ganon_tou_info.zsi" },
                { name: "Ganon's Castle Tower", filename: "ganon_info.zsi" },
                { name: "Ganon's Castle Tower (Crumbling)", filename: "ganon_sonogo_info.zsi" },
                { name: "Second-To-Last Boss Ganondorf", filename: "ganon_boss_info.zsi" },
                { name: "Final Battle Against Ganon", filename: "ganon_demo_info.zsi" },
                { name: "Ganondorf's Death", filename: "ganon_final_info.zsi" },
                { name: "Hyrule Field", filename: "spot00_info.zsi" },
                { name: "Kakariko Village", filename: "spot01_info.zsi" },
                { name: "Kakariko Graveyard", filename: "spot02_info.zsi" },
                { name: "Zora's River", filename: "spot03_info.zsi" },
                { name: "Kokiri Firest", filename: "spot04_info.zsi" },
                { name: "Sacred Forest Meadow", filename: "spot05_info.zsi" },
                { name: "Lake Hylia", filename: "spot06_info.zsi" },
                { name: "Zora's Domain", filename: "spot07_info.zsi" },
                { name: "Zora's Fountain", filename: "spot08_info.zsi" },
                { name: "Gerudo Valley", filename: "spot09_info.zsi" },
                { name: "Lost Woods", filename: "spot10_info.zsi" },
                { name: "Desert Colossus", filename: "spot11_info.zsi" },
                { name: "Gerudo's Fortress", filename: "spot12_info.zsi" },
                { name: "Haunted Wasteland", filename: "spot13_info.zsi" },
                { name: "Hyrule Castle", filename: "spot15_info.zsi" },
                { name: "Death Mountain", filename: "spot16_info.zsi" },
                { name: "Death Mountain Crater", filename: "spot17_info.zsi" },
                { name: "Goron City", filename: "spot18_info.zsi" },
                { name: "Lon Lon Ranch", filename: "spot20_info.zsi" },
                { name: "", filename: "spot99_info.zsi" },
                { name: "Market Entrance (Day)", filename: "entra_day_info.zsi" },
                { name: "Market Entrance (Night)", filename: "entra_night_info.zsi" },
                { name: "Market Entrance (Ruins)", filename: "entra_ruins_info.zsi" },
                { name: "Market (Day)", filename: "market_day_info.zsi" },
                { name: "Market (Night)", filename: "market_night_info.zsi" },
                { name: "Market (Ruins)", filename: "market_ruins_info.zsi" },
                { name: "Market Back-Alley (Day)", filename: "market_alley_info.zsi" },
                { name: "Market Back-Alley (Night)", filename: "market_alley_n_info.zsi" },
                { name: "Lots'o'Pots", filename: "miharigoya_info.zsi" },
                { name: "Bombchu Bowling Alley", filename: 'bowling_info.zsi' },
                { name: "Temple of Time (Outside, Day)", filename: "shrine_info.zsi" },
                { name: "Temple of Time (Outside, Night)", filename: "shrine_n_info.zsi" },
                { name: "Temple of Time (Outside, Adult)", filename: "shrine_r_info.zsi" },
                { name: "Temple of Time (Interior)", filename: "tokinoma_info.zsi" },
                { name: "Chamber of Sages", filename: "kenjyanoma_info.zsi" },
                { name: "Zora Shop", filename: "zoora_info.zsi" },
                { name: "Dampe's Hut", filename: "hut_info.zsi" },
                { name: "Great Fairy Fountain", filename: "daiyousei_izumi_info.zsi" },
                { name: "Small Fairy Fountain", filename: "yousei_izumi_tate_info.zsi" },
                { name: "Magic Fairy Fountain", filename: "yousei_izumi_yoko_info.zsi" },
                { name: "Castle Courtyard", filename: "hairal_niwa_info.zsi" },
                { name: "Castle Courtyard (Night)", filename: "hairal_niwa_n_info.zsi" },
                { name: '', filename: "hakaana_info.zsi" },
                { name: "Grottos", filename: "kakusiana_info.zsi" },
                { name: "Royal Family's Tomb", filename: "hakaana_ouke_info.zsi" },
                { name: "Dampe's Grave & Windmill Hut", filename: "hakasitarelay_info.zsi" },
                { name: "Cutscene Map", filename: "hiral_demo_info.zsi" },
                { name: "Hylia Lakeside Laboratory", filename: "hylia_labo_info.zsi" },
                { name: "Puppy Woman's House", filename: "kakariko_impa_info.zsi" },
                { name: "Skulltula House", filename: "kinsuta_info.zsi" },
                { name: "Impa's House", filename: "labo_info.zsi" },
                { name: "Granny's Potion Shop", filename: "mahouya_info.zsi" },
                { name: "Zelda's Courtyard", filename: "nakaniwa_info.zsi" },
                { name: "Market Potion Shop", filename: "shop_alley_info.zsi" },
                { name: "Kakariko Potion Shop", filename: "shop_drag_info.zsi" },
                { name: "Happy Mask Shop", filename: "shop_face_info.zsi" },
                { name: "Goron Shop", filename: "shop_golon_info.zsi" },
                { name: "Bombchu Shop", filename: "shop_night_info.zsi" },
                { name: "Talon's House", filename: "souko_info.zsi" },
                { name: "Stables", filename: "stable_info.zsi" },
                { name: "Shooting Gallery", filename: "syatekijyou_info.zsi" },
                { name: "Treasure Chest Game", filename: "takaraya_info.zsi" },
                { name: "Carpenter's Tent", filename: "tent_info.zsi" },
                { name: '', filename: "k_home_info.zsi" },
                { name: '', filename: "kakariko_info.zsi" },
                { name: '', filename: "kokiri_info.zsi" },
                { name: '', filename: "link_info.zsi" },
                { name: '', filename: "shop_info.zsi" },
                { name: "Fishing Pond", filename: "turibori_info.zsi" },
            ].map(function (entry) {
                var path = "data/oot3d/" + entry.filename;
                var name = entry.name || entry.filename;
                return new render_3.SceneDesc(name, path);
            });
            exports_15("sceneGroup", sceneGroup = { id: id, name: name, sceneDescs: sceneDescs });
        }
    };
});
System.register("sm64ds/crg0", ["util"], function (exports_16, context_16) {
    "use strict";
    var __moduleName = context_16 && context_16.id;
    function parse(buffer) {
        var view = new DataView(buffer);
        util_8.assert(util_8.readString(buffer, 0, 0x04) === 'CRG0');
        var levelTableCount = view.getUint32(0x08, false);
        var levelTableOffs = view.getUint32(0x0C, false);
        var levels = [];
        var levelTableIdx = levelTableOffs;
        for (var i = 0; i < levelTableCount; i++) {
            util_8.assert(view.getUint8(levelTableIdx) === 0x4d);
            var levelId = view.getUint8(levelTableIdx + 0x01);
            var levelAttributesCount = view.getUint8(levelTableIdx + 0x02);
            var levelMaterialsCount = view.getUint8(levelTableIdx + 0x03);
            levelTableIdx += 0x04;
            var levelAttributes = new Map();
            for (var j = 0; j < levelAttributesCount; j++) {
                var keyOffs = view.getUint32(levelTableIdx + 0x00, false);
                var valueOffs = view.getUint32(levelTableIdx + 0x04, false);
                var key = util_8.readString(buffer, keyOffs, 0x20);
                var value = util_8.readString(buffer, valueOffs, 0x20);
                levelTableIdx += 0x08;
                levelAttributes.set(key, value);
            }
            var materials = [];
            for (var j = 0; j < levelMaterialsCount; j++) {
                var materialNameOffs = view.getUint32(levelTableIdx + 0x00, false);
                var materialName = util_8.readString(buffer, materialNameOffs, 0x20);
                levelTableIdx += 0x04;
                var scaleOffs = view.getUint32(levelTableIdx + 0x00, false);
                var scaleCount = view.getUint32(levelTableIdx + 0x04, false);
                var scaleValues = new Float32Array(buffer, scaleOffs, scaleCount);
                levelTableIdx += 0x08;
                var rotationOffs = view.getUint32(levelTableIdx + 0x00, false);
                var rotationCount = view.getUint32(levelTableIdx + 0x04, false);
                var rotationValues = new Float32Array(buffer, rotationOffs, rotationCount);
                levelTableIdx += 0x08;
                var translationXOffs = view.getUint32(levelTableIdx + 0x00, false);
                var translationXCount = view.getUint32(levelTableIdx + 0x04, false);
                var translationXValues = new Float32Array(buffer, translationXOffs, translationXCount);
                levelTableIdx += 0x08;
                var translationYOffs = view.getUint32(levelTableIdx + 0x00, false);
                var translationYCount = view.getUint32(levelTableIdx + 0x04, false);
                var translationYValues = new Float32Array(buffer, translationYOffs, translationYCount);
                levelTableIdx += 0x08;
                var animations = [
                    { property: 'scale', values: scaleValues },
                    { property: 'rotation', values: rotationValues },
                    { property: 'x', values: translationXValues },
                    { property: 'x', values: translationYValues },
                ];
                materials.push({ name: materialName, animations: animations });
            }
            var id = '' + levelId;
            levels.push({ id: id, attributes: levelAttributes, materials: materials });
        }
        return { levels: levels };
    }
    exports_16("parse", parse);
    var util_8;
    return {
        setters: [
            function (util_8_1) {
                util_8 = util_8_1;
            }
        ],
        execute: function () {
        }
    };
});
// SM64DS's LZ10 wrapper, which is just a "LZ77" prefix for the file.
System.register("sm64ds/lz77", ["lz77", "util"], function (exports_17, context_17) {
    "use strict";
    var __moduleName = context_17 && context_17.id;
    function isLZ77(srcBuffer) {
        var srcView = new DataView(srcBuffer);
        return (util_9.readString(srcBuffer, 0x00, 0x05) === 'LZ77\x10');
    }
    exports_17("isLZ77", isLZ77);
    function maybeDecompress(srcBuffer) {
        if (isLZ77(srcBuffer))
            return lz77_1.decompress(srcBuffer.slice(4));
        else
            return srcBuffer;
    }
    exports_17("maybeDecompress", maybeDecompress);
    var lz77_1, util_9;
    return {
        setters: [
            function (lz77_1_1) {
                lz77_1 = lz77_1_1;
            },
            function (util_9_1) {
                util_9 = util_9_1;
            }
        ],
        execute: function () {
            // SM64DS's LZ10 wrapper, which is just a "LZ77" prefix for the file.
        }
    };
});
// Read DS texture formats.
System.register("sm64ds/nitro_tex", [], function (exports_18, context_18) {
    "use strict";
    var __moduleName = context_18 && context_18.id;
    function expand3to8(n) {
        return (n << (8 - 3)) | (n << (8 - 6)) | (n >>> (9 - 8));
    }
    function expand5to8(n) {
        return (n << (8 - 5)) | (n >>> (10 - 8));
    }
    function s3tcblend(a, b) {
        // return (a*3 + b*5) / 8;
        return (((a << 1) + a) + ((b << 2) + b)) >>> 3;
    }
    function bgr5(pixels, dstOffs, p) {
        pixels[dstOffs + 0] = expand5to8(p & 0x1F);
        pixels[dstOffs + 1] = expand5to8((p >>> 5) & 0x1F);
        pixels[dstOffs + 2] = expand5to8((p >>> 10) & 0x1F);
    }
    exports_18("bgr5", bgr5);
    function readTexture_A3I5(width, height, texData, palData) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var texBlock = texView.getUint8(srcOffs++);
                var palIdx = (texBlock & 0x1F) << 1;
                var alpha = texBlock >>> 5;
                var p = palView.getUint16(palIdx, true);
                var dstOffs = 4 * ((y * width) + x);
                bgr5(pixels, dstOffs, p);
                pixels[dstOffs + 3] = expand3to8(alpha);
            }
        }
        return pixels;
    }
    function readTexture_Palette16(width, height, texData, palData, color0) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var xx = 0; xx < width; xx += 4) {
                var texBlock = texView.getUint16(srcOffs, true);
                srcOffs += 2;
                for (var x = 0; x < 4; x++) {
                    var palIdx = texBlock & 0x0F;
                    var p = palView.getUint16(palIdx * 2, true);
                    var dstOffs = 4 * ((y * width) + xx + x);
                    bgr5(pixels, dstOffs, p);
                    pixels[dstOffs + 3] = palIdx === 0 ? (color0 ? 0x00 : 0xFF) : 0xFF;
                    texBlock >>= 4;
                }
            }
        }
        return pixels;
    }
    function readTexture_Palette256(width, height, texData, palData, color0) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var xx = 0; xx < width; xx++) {
                var palIdx = texView.getUint8(srcOffs++);
                var p = palView.getUint16(palIdx * 2, true);
                var dstOffs = 4 * ((y * width) + xx);
                bgr5(pixels, dstOffs, p);
                pixels[dstOffs + 3] = palIdx === 0 ? (color0 ? 0x00 : 0xFF) : 0xFF;
            }
        }
        return pixels;
    }
    function readTexture_CMPR_4x4(width, height, texData, palData) {
        function getPal16(offs) {
            return offs < palView.byteLength ? palView.getUint16(offs, true) : 0;
        }
        function buildColorTable(palBlock) {
            var palMode = palBlock >> 14;
            var palOffs = (palBlock & 0x3FFF) << 2;
            var colorTable = new Uint8Array(16);
            var p0 = getPal16(palOffs + 0x00);
            bgr5(colorTable, 0, p0);
            colorTable[3] = 0xFF;
            var p1 = getPal16(palOffs + 0x02);
            bgr5(colorTable, 4, p1);
            colorTable[7] = 0xFF;
            if (palMode === 0) {
                // PTY=0, A=0
                var p2 = getPal16(palOffs + 0x04);
                bgr5(colorTable, 8, p2);
                colorTable[11] = 0xFF;
                // Color4 is transparent black.
            }
            else if (palMode === 1) {
                // PTY=1, A=0
                // Color3 is a blend of Color1/Color2.
                colorTable[8] = (colorTable[0] + colorTable[4]) >>> 1;
                colorTable[9] = (colorTable[1] + colorTable[5]) >>> 1;
                colorTable[10] = (colorTable[2] + colorTable[6]) >>> 1;
                colorTable[11] = 0xFF;
                // Color4 is transparent black.
            }
            else if (palMode === 2) {
                // PTY=0, A=1
                var p2 = getPal16(palOffs + 0x04);
                bgr5(colorTable, 8, p2);
                colorTable[11] = 0xFF;
                var p3 = getPal16(palOffs + 0x06);
                bgr5(colorTable, 12, p3);
                colorTable[15] = 0xFF;
            }
            else {
                colorTable[8] = s3tcblend(colorTable[4], colorTable[0]);
                colorTable[9] = s3tcblend(colorTable[5], colorTable[1]);
                colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                colorTable[11] = 0xFF;
                colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                colorTable[15] = 0xFF;
            }
            return colorTable;
        }
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var palIdxStart = (width * height) / 4;
        var srcOffs = 0;
        for (var yy = 0; yy < height; yy += 4) {
            for (var xx = 0; xx < width; xx += 4) {
                var texBlock = texView.getUint32((srcOffs * 0x04), true);
                var palBlock = texView.getUint16(palIdxStart + (srcOffs * 0x02), true);
                var colorTable = buildColorTable(palBlock);
                for (var y = 0; y < 4; y++) {
                    for (var x = 0; x < 4; x++) {
                        var colorIdx = texBlock & 0x03;
                        var dstOffs = 4 * (((yy + y) * width) + xx + x);
                        pixels[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                        pixels[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                        pixels[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                        pixels[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                        texBlock >>= 2;
                    }
                }
                srcOffs++;
            }
        }
        return pixels;
    }
    function readTexture_A5I3(width, height, texData, palData) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var texBlock = texView.getUint8(srcOffs++);
                var palIdx = (texBlock & 0x03) << 1;
                var alpha = texBlock >>> 3;
                var p = palView.getUint16(palIdx, true);
                var dstOffs = 4 * ((y * width) + x);
                bgr5(pixels, dstOffs, p);
                pixels[dstOffs + 3] = expand5to8(alpha);
            }
        }
        return pixels;
    }
    function readTexture_Direct(width, height, texData) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var p = texView.getUint16(srcOffs, true);
                var dstOffs = 4 * ((y * width) + x);
                bgr5(pixels, dstOffs, p);
                pixels[dstOffs + 3] = 0xFF;
                srcOffs += 2;
            }
        }
        return pixels;
    }
    function readTexture(format, width, height, texData, palData, color0) {
        switch (format) {
            case Format.Tex_A3I5:
                return readTexture_A3I5(width, height, texData, palData);
            case Format.Tex_Palette16:
                return readTexture_Palette16(width, height, texData, palData, color0);
            case Format.Tex_Palette256:
                return readTexture_Palette256(width, height, texData, palData, color0);
            case Format.Tex_CMPR_4x4:
                return readTexture_CMPR_4x4(width, height, texData, palData);
            case Format.Tex_A5I3:
                return readTexture_A5I3(width, height, texData, palData);
            case Format.Tex_Direct:
                return readTexture_Direct(width, height, texData);
            default:
                throw new Error("Unsupported texture type! " + format);
        }
    }
    exports_18("readTexture", readTexture);
    var Format;
    return {
        setters: [],
        execute: function () {// Read DS texture formats.
            (function (Format) {
                Format[Format["Tex_None"] = 0] = "Tex_None";
                Format[Format["Tex_A3I5"] = 1] = "Tex_A3I5";
                Format[Format["Tex_Palette4"] = 2] = "Tex_Palette4";
                Format[Format["Tex_Palette16"] = 3] = "Tex_Palette16";
                Format[Format["Tex_Palette256"] = 4] = "Tex_Palette256";
                Format[Format["Tex_CMPR_4x4"] = 5] = "Tex_CMPR_4x4";
                Format[Format["Tex_A5I3"] = 6] = "Tex_A5I3";
                Format[Format["Tex_Direct"] = 7] = "Tex_Direct";
            })(Format || (Format = {}));
            exports_18("Format", Format);
        }
    };
});
// Read DS Geometry Engine commands.
System.register("sm64ds/nitro_gx", ["sm64ds/nitro_tex"], function (exports_19, context_19) {
    "use strict";
    var __moduleName = context_19 && context_19.id;
    function bgr5(pixel) {
        nitro_tex_1.bgr5(tmp, 0, pixel);
        var r = tmp[0], g = tmp[1], b = tmp[2];
        return { r: r, g: g, b: b };
    }
    exports_19("bgr5", bgr5);
    function cmd_MTX_RESTORE(ctx) {
        // XXX: We don't implement the matrix stack yet.
        ctx.readParam();
    }
    function cmd_COLOR(ctx) {
        var param = ctx.readParam();
        ctx.s_color = bgr5(param);
    }
    function cmd_NORMAL(ctx) {
        var param = ctx.readParam();
    }
    function cmd_TEXCOORD(ctx) {
        var param = ctx.readParam();
        var s = param & 0xFFFF;
        var t = param >> 16;
        // Sign extend.
        s = (s << 16 >> 16);
        t = (t << 16 >> 16);
        // Fixed point.
        s = s / 16.0;
        t = t / 16.0;
        ctx.s_texCoord = { s: s, t: t };
    }
    function cmd_VTX_16(ctx) {
        var param1 = ctx.readParam();
        var x = (param1 & 0xFFFF);
        var y = (param1 >> 16) & 0xFFFF;
        var param2 = ctx.readParam();
        var z = (param2 & 0xFFFF);
        // Sign extend.
        x = (x << 16 >> 16);
        y = (y << 16 >> 16);
        z = (z << 16 >> 16);
        // Fixed point.
        x = x / 4096.0;
        y = y / 4096.0;
        z = z / 4096.0;
        ctx.vtx(x, y, z);
    }
    function cmd_VTX_10(ctx) {
        var param = ctx.readParam();
        var x = (param & 0x03FF);
        var y = (param >> 10) & 0x03FF;
        var z = (param >> 20) & 0x03FF;
        // Sign extend.
        x = (x << 22 >> 22);
        y = (y << 22 >> 22);
        z = (z << 22 >> 22);
        // Fixed point.
        x = x / 64.0;
        y = y / 64.0;
        z = z / 64.0;
        ctx.vtx(x, y, z);
    }
    function cmd_VTX_XY(ctx) {
        var param = ctx.readParam();
        var x = (param & 0xFFFF);
        var y = (param >> 16) & 0xFFFF;
        // Sign extend.
        x = (x << 16 >> 16);
        y = (y << 16 >> 16);
        // Fixed point.
        x = x / 4096.0;
        y = y / 4096.0;
        ctx.vtx(x, y, ctx.s_vtx.z);
    }
    function cmd_VTX_XZ(ctx) {
        var param = ctx.readParam();
        var x = (param & 0xFFFF);
        var z = (param >> 16) & 0xFFFF;
        // Sign extend.
        x = (x << 16 >> 16);
        z = (z << 16 >> 16);
        // Fixed point.
        x = x / 4096.0;
        z = z / 4096.0;
        ctx.vtx(x, ctx.s_vtx.y, z);
    }
    function cmd_VTX_YZ(ctx) {
        var param = ctx.readParam();
        var y = (param & 0xFFFF);
        var z = (param >> 16) & 0xFFFF;
        // Sign extend.
        y = (y << 16 >> 16);
        z = (z << 16 >> 16);
        // Fixed point.
        y = y / 4096.0;
        z = z / 4096.0;
        ctx.vtx(ctx.s_vtx.x, y, z);
    }
    function cmd_VTX_DIFF(ctx) {
        var param = ctx.readParam();
        var x = (param & 0x03FF);
        var y = (param >> 10) & 0x03FF;
        var z = (param >> 20) & 0x03FF;
        // Sign extend.
        x = (x << 22 >> 22);
        y = (y << 22 >> 22);
        z = (z << 22 >> 22);
        // Fixed point.
        x = x / 4096.0;
        y = y / 4096.0;
        z = z / 4096.0;
        // Add on the difference...
        x += ctx.s_vtx.x;
        y += ctx.s_vtx.y;
        z += ctx.s_vtx.z;
        ctx.vtx(x, y, z);
    }
    function cmd_DIF_AMB(ctx) {
        var param = ctx.readParam();
        // TODO: lighting
    }
    function cmd_BEGIN_VTXS(ctx) {
        var param = ctx.readParam();
        var polyType = param & 0x03;
        ctx.s_polyType = polyType;
        ctx.vtxs = [];
    }
    function cmd_END_VTXS(ctx) {
        var nVerts = ctx.vtxs.length;
        var vtxBuffer = new Float32Array(nVerts * VERTEX_SIZE);
        for (var i = 0; i < nVerts; i++) {
            var v = ctx.vtxs[i];
            var vtxArray = new Float32Array(vtxBuffer.buffer, i * VERTEX_BYTES, VERTEX_SIZE);
            vtxArray[0] = v.pos.x;
            vtxArray[1] = v.pos.y;
            vtxArray[2] = v.pos.z;
            vtxArray[3] = v.color.r / 0xFF;
            vtxArray[4] = v.color.g / 0xFF;
            vtxArray[5] = v.color.b / 0xFF;
            vtxArray[6] = ctx.alpha / 0xFF;
            vtxArray[7] = v.uv.s;
            vtxArray[8] = v.uv.t;
        }
        var idxBuffer;
        if (ctx.s_polyType === PolyType.TRIANGLES) {
            idxBuffer = new Uint16Array(nVerts);
            for (var i = 0; i < nVerts; i++)
                idxBuffer[i] = i;
        }
        else if (ctx.s_polyType === PolyType.QUADS) {
            idxBuffer = new Uint16Array(nVerts / 4 * 6);
            var dst = 0;
            for (var i = 0; i < nVerts; i += 4) {
                idxBuffer[dst++] = i + 0;
                idxBuffer[dst++] = i + 1;
                idxBuffer[dst++] = i + 2;
                idxBuffer[dst++] = i + 2;
                idxBuffer[dst++] = i + 3;
                idxBuffer[dst++] = i + 0;
            }
        }
        else if (ctx.s_polyType === PolyType.TRIANGLE_STRIP) {
            idxBuffer = new Uint16Array((nVerts - 2) * 3);
            var dst = 0;
            for (var i = 0; i < nVerts - 2; i++) {
                if (i % 2 === 0) {
                    idxBuffer[dst++] = i + 0;
                    idxBuffer[dst++] = i + 1;
                    idxBuffer[dst++] = i + 2;
                }
                else {
                    idxBuffer[dst++] = i + 1;
                    idxBuffer[dst++] = i + 0;
                    idxBuffer[dst++] = i + 2;
                }
            }
        }
        else if (ctx.s_polyType === PolyType.QUAD_STRIP) {
            idxBuffer = new Uint16Array(((nVerts - 2) / 2) * 6);
            var dst = 0;
            for (var i = 0; i < nVerts; i += 2) {
                idxBuffer[dst++] = i + 0;
                idxBuffer[dst++] = i + 1;
                idxBuffer[dst++] = i + 3;
                idxBuffer[dst++] = i + 3;
                idxBuffer[dst++] = i + 2;
                idxBuffer[dst++] = i + 0;
            }
        }
        var packet = { vertData: vtxBuffer, idxData: idxBuffer, polyType: ctx.s_polyType };
        ctx.packets.push(packet);
    }
    function runCmd(ctx, cmd) {
        switch (cmd) {
            case 0: return;
            case CmdType.MTX_RESTORE: return cmd_MTX_RESTORE(ctx);
            case CmdType.COLOR: return cmd_COLOR(ctx);
            case CmdType.NORMAL: return cmd_NORMAL(ctx);
            case CmdType.TEXCOORD: return cmd_TEXCOORD(ctx);
            case CmdType.VTX_16: return cmd_VTX_16(ctx);
            case CmdType.VTX_10: return cmd_VTX_10(ctx);
            case CmdType.VTX_XY: return cmd_VTX_XY(ctx);
            case CmdType.VTX_XZ: return cmd_VTX_XZ(ctx);
            case CmdType.VTX_YZ: return cmd_VTX_YZ(ctx);
            case CmdType.VTX_DIFF: return cmd_VTX_DIFF(ctx);
            case CmdType.DIF_AMB: return cmd_DIF_AMB(ctx);
            case CmdType.BEGIN_VTXS: return cmd_BEGIN_VTXS(ctx);
            case CmdType.END_VTXS: return cmd_END_VTXS(ctx);
            default: console.warn("Missing command", cmd.toString(16));
        }
    }
    function readCmds(buffer, baseCtx) {
        var ctx = new ContextInternal(buffer, baseCtx);
        while (ctx.offs < buffer.byteLength) {
            // Commands are packed 4 at a time...
            var cmd0 = ctx.view.getUint8(ctx.offs++);
            var cmd1 = ctx.view.getUint8(ctx.offs++);
            var cmd2 = ctx.view.getUint8(ctx.offs++);
            var cmd3 = ctx.view.getUint8(ctx.offs++);
            runCmd(ctx, cmd0);
            runCmd(ctx, cmd1);
            runCmd(ctx, cmd2);
            runCmd(ctx, cmd3);
        }
        return ctx.packets;
    }
    exports_19("readCmds", readCmds);
    var nitro_tex_1, CmdType, PolyType, VERTEX_SIZE, VERTEX_BYTES, tmp, Context, ContextInternal;
    return {
        setters: [
            function (nitro_tex_1_1) {
                nitro_tex_1 = nitro_tex_1_1;
            }
        ],
        execute: function () {
            // Read DS Geometry Engine commands.
            // tslint:disable:variable-name
            (function (CmdType) {
                CmdType[CmdType["MTX_RESTORE"] = 20] = "MTX_RESTORE";
                CmdType[CmdType["COLOR"] = 32] = "COLOR";
                CmdType[CmdType["NORMAL"] = 33] = "NORMAL";
                CmdType[CmdType["TEXCOORD"] = 34] = "TEXCOORD";
                CmdType[CmdType["VTX_16"] = 35] = "VTX_16";
                CmdType[CmdType["VTX_10"] = 36] = "VTX_10";
                CmdType[CmdType["VTX_XY"] = 37] = "VTX_XY";
                CmdType[CmdType["VTX_XZ"] = 38] = "VTX_XZ";
                CmdType[CmdType["VTX_YZ"] = 39] = "VTX_YZ";
                CmdType[CmdType["VTX_DIFF"] = 40] = "VTX_DIFF";
                CmdType[CmdType["DIF_AMB"] = 48] = "DIF_AMB";
                CmdType[CmdType["BEGIN_VTXS"] = 64] = "BEGIN_VTXS";
                CmdType[CmdType["END_VTXS"] = 65] = "END_VTXS";
            })(CmdType || (CmdType = {}));
            (function (PolyType) {
                PolyType[PolyType["TRIANGLES"] = 0] = "TRIANGLES";
                PolyType[PolyType["QUADS"] = 1] = "QUADS";
                PolyType[PolyType["TRIANGLE_STRIP"] = 2] = "TRIANGLE_STRIP";
                PolyType[PolyType["QUAD_STRIP"] = 3] = "QUAD_STRIP";
            })(PolyType || (PolyType = {}));
            // 3 pos + 4 color + 2 uv
            VERTEX_SIZE = 9;
            VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
            tmp = new Uint8Array(3);
            Context = /** @class */ (function () {
                function Context() {
                }
                return Context;
            }());
            exports_19("Context", Context);
            ContextInternal = /** @class */ (function () {
                function ContextInternal(buffer, baseCtx) {
                    this.offs = 0;
                    this.alpha = baseCtx.alpha;
                    this.s_color = baseCtx.color;
                    this.view = new DataView(buffer);
                    this.s_texCoord = { s: 0, t: 0 };
                    this.packets = [];
                }
                ContextInternal.prototype.readParam = function () {
                    return this.view.getUint32((this.offs += 4) - 4, true);
                };
                ContextInternal.prototype.vtx = function (x, y, z) {
                    this.s_vtx = { x: x, y: y, z: z };
                    this.vtxs.push({ pos: this.s_vtx, nrm: this.s_nrm, color: this.s_color, uv: this.s_texCoord });
                };
                return ContextInternal;
            }());
        }
    };
});
System.register("sm64ds/nitro_bmd", ["gl-matrix", "sm64ds/nitro_gx", "sm64ds/nitro_tex", "util"], function (exports_20, context_20) {
    "use strict";
    var __moduleName = context_20 && context_20.id;
    function parseModel(bmd, view, idx) {
        var offs = bmd.modelOffsBase + idx * 0x40;
        var model = new Model();
        model.id = view.getUint32(offs + 0x00, true);
        model.name = util_10.readString(view.buffer, view.getUint32(offs + 0x04, true), 0xFF);
        model.parentID = view.getUint16(offs + 0x08, true);
        // Local transform.
        var xs = view.getUint32(offs + 0x10, true);
        var ys = view.getUint32(offs + 0x14, true);
        var zs = view.getUint32(offs + 0x18, true);
        var xr = view.getUint16(offs + 0x1C, true);
        var yr = view.getUint16(offs + 0x1E, true);
        var zr = view.getUint16(offs + 0x20, true);
        var xt = view.getUint16(offs + 0x24, true);
        var yt = view.getUint16(offs + 0x28, true);
        var zt = view.getUint16(offs + 0x2C, true);
        // A "batch" is a combination of a material and a poly.
        var batchCount = view.getUint32(offs + 0x30, true);
        var batchMaterialOffs = view.getUint32(offs + 0x34, true);
        var batchPolyOffs = view.getUint32(offs + 0x38, true);
        model.batches = [];
        for (var i = 0; i < batchCount; i++) {
            var materialIdx = view.getUint8(batchMaterialOffs + i);
            var material = parseMaterial(bmd, view, materialIdx);
            var baseCtx = { color: material.diffuse, alpha: material.alpha };
            if (material.name === "mat_mu") {
                console.log("AAA");
            }
            var polyIdx = view.getUint8(batchPolyOffs + i);
            var poly = parsePoly(bmd, view, polyIdx, baseCtx);
            model.batches.push({ material: material, poly: poly });
        }
        return model;
    }
    function parsePoly(bmd, view, idx, baseCtx) {
        var offs = view.getUint32((bmd.polyOffsBase + idx * 0x08) + 0x04, true);
        var gxCmdSize = view.getUint32(offs + 0x08, true);
        var gxCmdOffs = view.getUint32(offs + 0x0C, true);
        var gxCmdBuf = view.buffer.slice(gxCmdOffs, gxCmdOffs + gxCmdSize);
        var packets = NITRO_GX.readCmds(gxCmdBuf, baseCtx);
        return { packets: packets };
    }
    function parseMaterial(bmd, view, idx) {
        var offs = bmd.materialOffsBase + idx * 0x30;
        var material = {};
        material.name = util_10.readString(view.buffer, view.getUint32(offs + 0x00, true), 0xFF);
        material.texCoordMat = gl_matrix_2.mat2d.create();
        var textureIdx = view.getUint32(offs + 0x04, true);
        if (textureIdx !== 0xFFFFFFFF) {
            var paletteIdx = view.getUint32(offs + 0x08, true);
            var textureKey = new TextureKey(textureIdx, paletteIdx);
            material.texture = parseTexture(bmd, view, textureKey);
            material.texParams = material.texture.params | view.getUint32(offs + 0x20, true);
            if (material.texParams >> 30) {
                var scaleS = view.getInt32(offs + 0x0C, true) / 4096.0;
                var scaleT = view.getInt32(offs + 0x10, true) / 4096.0;
                var transS = view.getInt32(offs + 0x18, true) / 4096.0;
                var transT = view.getInt32(offs + 0x1C, true) / 4096.0;
                gl_matrix_2.mat2d.translate(material.texCoordMat, material.texCoordMat, [transS, transT, 0.0]);
                gl_matrix_2.mat2d.scale(material.texCoordMat, material.texCoordMat, [scaleS, scaleT, 1.0]);
            }
            var texScale = [1 / material.texture.width, 1 / material.texture.height, 1];
            gl_matrix_2.mat2d.scale(material.texCoordMat, material.texCoordMat, texScale);
        }
        else {
            material.texture = null;
            material.texParams = 0;
        }
        var polyAttribs = view.getUint32(offs + 0x24, true);
        var alpha = (polyAttribs >> 16) & 0x1F;
        alpha = (alpha << (8 - 5)) | (alpha >>> (10 - 8));
        var renderWhichFaces = (polyAttribs >> 6) & 0x03;
        material.renderWhichFaces = renderWhichFaces;
        // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
        // A transparent polygon is one that has an alpha of < 0xFF, or uses
        // A5I3 / A3I5 textures.
        material.isTranslucent = (alpha < 0xFF) || (material.texture && material.texture.isTranslucent);
        // Do transparent polys write to the depth buffer?
        var xl = (polyAttribs >>> 11) & 0x01;
        if (xl)
            material.depthWrite = true;
        else
            material.depthWrite = !material.isTranslucent;
        var difAmb = view.getUint32(offs + 0x28, true);
        if (difAmb & 0x8000)
            material.diffuse = NITRO_GX.bgr5(difAmb);
        else
            material.diffuse = { r: 0xFF, g: 0xFF, b: 0xFF };
        material.alpha = alpha;
        return material;
    }
    function parseTexture(bmd, view, key) {
        if (bmd.textureCache.has(key.toString()))
            return bmd.textureCache.get(key.toString());
        var texOffs = bmd.textureOffsBase + key.texIdx * 0x14;
        var texture = new Texture();
        texture.id = key.texIdx;
        texture.name = util_10.readString(view.buffer, view.getUint32(texOffs + 0x00, true), 0xFF);
        var texDataOffs = view.getUint32(texOffs + 0x04, true);
        var texDataSize = view.getUint32(texOffs + 0x08, true);
        var texData = view.buffer.slice(texDataOffs);
        texture.params = view.getUint32(texOffs + 0x10, true);
        texture.format = (texture.params >> 26) & 0x07;
        texture.width = 8 << ((texture.params >> 20) & 0x07);
        texture.height = 8 << ((texture.params >> 23) & 0x07);
        var color0 = !!((texture.params >> 29) & 0x01);
        var palData = null;
        if (key.palIdx !== 0xFFFFFFFF) {
            var palOffs = bmd.paletteOffsBase + key.palIdx * 0x10;
            texture.paletteName = util_10.readString(view.buffer, view.getUint32(palOffs + 0x00, true), 0xFF);
            var palDataOffs = view.getUint32(palOffs + 0x04, true);
            var palDataSize = view.getUint32(palOffs + 0x08, true);
            palData = view.buffer.slice(palDataOffs, palDataOffs + palDataSize);
        }
        texture.pixels = NITRO_Tex.readTexture(texture.format, texture.width, texture.height, texData, palData, color0);
        texture.isTranslucent = (texture.format === NITRO_Tex.Format.Tex_A5I3 ||
            texture.format === NITRO_Tex.Format.Tex_A3I5);
        bmd.textures.push(texture);
        bmd.textureCache.set(key.toString(), texture);
        return texture;
    }
    function parse(buffer) {
        var view = new DataView(buffer);
        var bmd = new BMD();
        bmd.scaleFactor = (1 << view.getUint32(0x00, true));
        bmd.modelCount = view.getUint32(0x04, true);
        bmd.modelOffsBase = view.getUint32(0x08, true);
        bmd.polyCount = view.getUint32(0x0C, true);
        bmd.polyOffsBase = view.getUint32(0x10, true);
        bmd.textureCount = view.getUint32(0x14, true);
        bmd.textureOffsBase = view.getUint32(0x18, true);
        bmd.paletteCount = view.getUint32(0x1C, true);
        bmd.paletteOffsBase = view.getUint32(0x20, true);
        bmd.materialCount = view.getUint32(0x24, true);
        bmd.materialOffsBase = view.getUint32(0x28, true);
        bmd.textureCache = new Map();
        bmd.textures = [];
        bmd.models = [];
        for (var i = 0; i < bmd.modelCount; i++)
            bmd.models.push(parseModel(bmd, view, i));
        return bmd;
    }
    exports_20("parse", parse);
    var gl_matrix_2, NITRO_GX, NITRO_Tex, util_10, Poly, Batch, Model, TextureKey, Texture, BMD;
    return {
        setters: [
            function (gl_matrix_2_1) {
                gl_matrix_2 = gl_matrix_2_1;
            },
            function (NITRO_GX_1) {
                NITRO_GX = NITRO_GX_1;
            },
            function (NITRO_Tex_1) {
                NITRO_Tex = NITRO_Tex_1;
            },
            function (util_10_1) {
                util_10 = util_10_1;
            }
        ],
        execute: function () {
            // Super Mario 64 DS .bmd format
            Poly = /** @class */ (function () {
                function Poly() {
                }
                return Poly;
            }());
            exports_20("Poly", Poly);
            Batch = /** @class */ (function () {
                function Batch() {
                }
                return Batch;
            }());
            exports_20("Batch", Batch);
            Model = /** @class */ (function () {
                function Model() {
                }
                return Model;
            }());
            exports_20("Model", Model);
            TextureKey = /** @class */ (function () {
                function TextureKey(texIdx, palIdx) {
                    this.texIdx = texIdx;
                    this.palIdx = palIdx;
                }
                TextureKey.prototype.toString = function () {
                    return "TextureKey " + this.texIdx + " " + this.palIdx;
                };
                return TextureKey;
            }());
            Texture = /** @class */ (function () {
                function Texture() {
                }
                return Texture;
            }());
            exports_20("Texture", Texture);
            BMD = /** @class */ (function () {
                function BMD() {
                }
                return BMD;
            }());
            exports_20("BMD", BMD);
        }
    };
});
System.register("sm64ds/render", ["gl-matrix", "viewer", "sm64ds/crg0", "sm64ds/lz77", "sm64ds/nitro_bmd", "util"], function (exports_21, context_21) {
    "use strict";
    var __moduleName = context_21 && context_21.id;
    function textureToCanvas(bmdTex) {
        var canvas = document.createElement("canvas");
        canvas.width = bmdTex.width;
        canvas.height = bmdTex.height;
        canvas.title = bmdTex.name + " (" + bmdTex.format + ")";
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);
        for (var i = 0; i < imgData.data.length; i++)
            imgData.data[i] = bmdTex.pixels[i];
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }
    var gl_matrix_3, Viewer, CRG0, LZ77, NITRO_BMD, util_11, DL_VERT_SHADER_SOURCE, DL_FRAG_SHADER_SOURCE, NITRO_Program, VERTEX_SIZE, VERTEX_BYTES, RenderPass, Scene, MultiScene, SceneDesc;
    return {
        setters: [
            function (gl_matrix_3_1) {
                gl_matrix_3 = gl_matrix_3_1;
            },
            function (Viewer_4) {
                Viewer = Viewer_4;
            },
            function (CRG0_1) {
                CRG0 = CRG0_1;
            },
            function (LZ77_1) {
                LZ77 = LZ77_1;
            },
            function (NITRO_BMD_1) {
                NITRO_BMD = NITRO_BMD_1;
            },
            function (util_11_1) {
                util_11 = util_11_1;
            }
        ],
        execute: function () {
            DL_VERT_SHADER_SOURCE = "\n    precision mediump float;\n    uniform mat4 u_modelView;\n    uniform mat4 u_localMatrix;\n    uniform mat4 u_projection;\n    uniform mat3 u_texCoordMat;\n    attribute vec3 a_position;\n    attribute vec2 a_uv;\n    attribute vec4 a_color;\n    varying vec4 v_color;\n    varying vec2 v_uv;\n\n    void main() {\n        gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);\n        v_color = a_color;\n        v_uv = (u_texCoordMat * vec3(a_uv, 1.0)).st;\n    }\n";
            DL_FRAG_SHADER_SOURCE = "\n    precision mediump float;\n    varying vec2 v_uv;\n    varying vec4 v_color;\n    uniform sampler2D u_texture;\n\n    void main() {\n        gl_FragColor = texture2D(u_texture, v_uv);\n        gl_FragColor *= v_color;\n        if (gl_FragColor.a == 0.0)\n            discard;\n    }\n";
            NITRO_Program = /** @class */ (function (_super) {
                __extends(NITRO_Program, _super);
                function NITRO_Program() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = DL_VERT_SHADER_SOURCE;
                    _this.frag = DL_FRAG_SHADER_SOURCE;
                    return _this;
                }
                NITRO_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
                    this.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.colorLocation = gl.getAttribLocation(prog, "a_color");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return NITRO_Program;
            }(Viewer.Program));
            // 3 pos + 4 color + 2 uv
            VERTEX_SIZE = 9;
            VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
            (function (RenderPass) {
                RenderPass[RenderPass["OPAQUE"] = 1] = "OPAQUE";
                RenderPass[RenderPass["TRANSLUCENT"] = 2] = "TRANSLUCENT";
            })(RenderPass || (RenderPass = {}));
            Scene = /** @class */ (function () {
                function Scene(gl, bmd, localScale, crg0Level) {
                    var _this = this;
                    this.cameraController = Viewer.FPSCameraController;
                    this.program = new NITRO_Program();
                    this.bmd = bmd;
                    this.localScale = localScale;
                    this.crg0Level = crg0Level;
                    this.isSkybox = false;
                    this.textures = bmd.textures.map(function (texture) {
                        return textureToCanvas(texture);
                    });
                    this.modelFuncs = bmd.models.map(function (bmdm) { return _this.translateModel(gl, bmdm); });
                }
                Scene.prototype.translatePacket = function (gl, packet) {
                    var _this = this;
                    var vertBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);
                    var idxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);
                    return function () {
                        gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                        gl.vertexAttribPointer(_this.program.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
                        gl.vertexAttribPointer(_this.program.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
                        gl.vertexAttribPointer(_this.program.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
                        gl.enableVertexAttribArray(_this.program.positionLocation);
                        gl.enableVertexAttribArray(_this.program.colorLocation);
                        gl.enableVertexAttribArray(_this.program.uvLocation);
                        gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
                        gl.disableVertexAttribArray(_this.program.positionLocation);
                        gl.disableVertexAttribArray(_this.program.colorLocation);
                        gl.disableVertexAttribArray(_this.program.uvLocation);
                    };
                };
                Scene.prototype.translatePoly = function (gl, poly) {
                    var _this = this;
                    var funcs = poly.packets.map(function (packet) { return _this.translatePacket(gl, packet); });
                    return function (state) {
                        funcs.forEach(function (f) { f(); });
                    };
                };
                Scene.prototype.translateMaterial = function (gl, material) {
                    var _this = this;
                    var texture = material.texture;
                    var texId;
                    function wrapMode(repeat, flip) {
                        if (repeat)
                            return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
                        else
                            return gl.CLAMP_TO_EDGE;
                    }
                    if (texture !== null) {
                        texId = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, texId);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                        var repeatS = (material.texParams >> 16) & 0x01;
                        var repeatT = (material.texParams >> 17) & 0x01;
                        var flipS = (material.texParams >> 18) & 0x01;
                        var flipT = (material.texParams >> 19) & 0x01;
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));
                        gl.bindTexture(gl.TEXTURE_2D, texId);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
                    }
                    // Find any possible material animations.
                    var crg0mat = this.crg0Level.materials.find(function (crg0mat) { return crg0mat.name === material.name; });
                    var texCoordMat = gl_matrix_3.mat3.create();
                    gl_matrix_3.mat3.fromMat2d(texCoordMat, material.texCoordMat);
                    return function (state) {
                        if (crg0mat !== undefined) {
                            var texAnimMat = gl_matrix_3.mat3.create();
                            try {
                                for (var _a = __values(crg0mat.animations), _b = _a.next(); !_b.done; _b = _a.next()) {
                                    var anim = _b.value;
                                    var time = state.time / 30;
                                    var value = anim.values[(time | 0) % anim.values.length];
                                    if (anim.property === 'x')
                                        gl_matrix_3.mat3.translate(texAnimMat, texAnimMat, [0, value]);
                                    else if (anim.property === 'y')
                                        gl_matrix_3.mat3.translate(texAnimMat, texAnimMat, [value, 0]);
                                    else if (anim.property === 'scale')
                                        gl_matrix_3.mat3.scale(texAnimMat, texAnimMat, [value, value]);
                                    else if (anim.property === 'rotation')
                                        gl_matrix_3.mat3.rotate(texAnimMat, texAnimMat, value / 180 * Math.PI);
                                }
                            }
                            catch (e_11_1) { e_11 = { error: e_11_1 }; }
                            finally {
                                try {
                                    if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                                }
                                finally { if (e_11) throw e_11.error; }
                            }
                            gl_matrix_3.mat3.fromMat2d(texCoordMat, material.texCoordMat);
                            gl_matrix_3.mat3.multiply(texCoordMat, texAnimMat, texCoordMat);
                        }
                        if (texture !== null) {
                            gl.uniformMatrix3fv(_this.program.texCoordMatLocation, false, texCoordMat);
                            gl.bindTexture(gl.TEXTURE_2D, texId);
                        }
                        gl.depthMask(material.depthWrite);
                        switch (material.renderWhichFaces) {
                            case 0x00:// Render Nothing
                                gl.enable(gl.CULL_FACE);
                                gl.cullFace(gl.FRONT_AND_BACK);
                                break;
                            case 0x01:// Render Back
                                gl.enable(gl.CULL_FACE);
                                gl.cullFace(gl.FRONT);
                                break;
                            case 0x02:// Render Front
                                gl.enable(gl.CULL_FACE);
                                gl.cullFace(gl.BACK);
                                break;
                            case 0x03:// Render Front and Back
                                gl.disable(gl.CULL_FACE);
                                break;
                        }
                        var e_11, _c;
                    };
                };
                Scene.prototype.translateBatch = function (gl, batch) {
                    var batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;
                    var applyMaterial = this.translateMaterial(gl, batch.material);
                    var renderPoly = this.translatePoly(gl, batch.poly);
                    return function (state, pass) {
                        if (pass !== batchPass)
                            return;
                        applyMaterial(state);
                        renderPoly(state);
                    };
                };
                Scene.prototype.translateModel = function (gl, bmdm) {
                    var _this = this;
                    var skyboxCameraMat = gl_matrix_3.mat4.create();
                    var localMatrix = gl_matrix_3.mat4.create();
                    var bmd = this.bmd;
                    var scaleFactor = bmd.scaleFactor * this.localScale;
                    gl_matrix_3.mat4.scale(localMatrix, localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
                    var batches = bmdm.batches.map(function (batch) { return _this.translateBatch(gl, batch); });
                    return function (state, pass) {
                        if (_this.isSkybox) {
                            // XXX: Kind of disgusting. Calculate a skybox camera matrix by removing translation.
                            gl_matrix_3.mat4.copy(skyboxCameraMat, state.modelView);
                            skyboxCameraMat[12] = 0;
                            skyboxCameraMat[13] = 0;
                            skyboxCameraMat[14] = 0;
                            gl.uniformMatrix4fv(_this.program.modelViewLocation, false, skyboxCameraMat);
                        }
                        gl.uniformMatrix4fv(_this.program.localMatrixLocation, false, localMatrix);
                        batches.forEach(function (f) { f(state, pass); });
                    };
                };
                Scene.prototype.renderModels = function (state, pass) {
                    return this.modelFuncs.forEach(function (func) {
                        func(state, pass);
                    });
                };
                Scene.prototype.render = function (state) {
                    var gl = state.viewport.gl;
                    state.useProgram(this.program);
                    gl.enable(gl.DEPTH_TEST);
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    // First pass, opaque.
                    this.renderModels(state, RenderPass.OPAQUE);
                    // Second pass, translucent.
                    this.renderModels(state, RenderPass.TRANSLUCENT);
                };
                return Scene;
            }());
            MultiScene = /** @class */ (function () {
                function MultiScene(scenes) {
                    this.cameraController = Viewer.FPSCameraController;
                    this.scenes = scenes;
                    this.textures = [];
                    try {
                        for (var _a = __values(this.scenes), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var scene = _b.value;
                            this.textures = this.textures.concat(scene.textures);
                        }
                    }
                    catch (e_12_1) { e_12 = { error: e_12_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_12) throw e_12.error; }
                    }
                    var e_12, _c;
                }
                MultiScene.prototype.render = function (renderState) {
                    this.scenes.forEach(function (scene) { return scene.render(renderState); });
                };
                return MultiScene;
            }());
            SceneDesc = /** @class */ (function () {
                function SceneDesc(name, levelId) {
                    this.name = name;
                    this.levelId = levelId;
                    this.id = '' + this.levelId;
                }
                SceneDesc.prototype._createBmdScene = function (gl, filename, localScale, level, isSkybox) {
                    return util_11.fetch("data/sm64ds/" + filename).then(function (result) {
                        result = LZ77.maybeDecompress(result);
                        var bmd = NITRO_BMD.parse(result);
                        var scene = new Scene(gl, bmd, localScale, level);
                        scene.isSkybox = isSkybox;
                        return scene;
                    });
                };
                SceneDesc.prototype._createSceneFromCRG0 = function (gl, crg0) {
                    var level = crg0.levels[this.levelId];
                    var scenes = [this._createBmdScene(gl, level.attributes.get('bmd'), 100, level, false)];
                    if (level.attributes.get('vrbox'))
                        scenes.unshift(this._createBmdScene(gl, level.attributes.get('vrbox'), 0.8, level, true));
                    return Promise.all(scenes).then(function (results) {
                        return new MultiScene(results);
                    });
                };
                SceneDesc.prototype.createScene = function (gl) {
                    var _this = this;
                    return util_11.fetch('data/sm64ds/sm64ds.crg0').then(function (result) {
                        var crg0 = CRG0.parse(result);
                        return _this._createSceneFromCRG0(gl, crg0);
                    });
                };
                return SceneDesc;
            }());
            exports_21("SceneDesc", SceneDesc);
        }
    };
});
System.register("sm64ds/scenes", ["sm64ds/render"], function (exports_22, context_22) {
    "use strict";
    var __moduleName = context_22 && context_22.id;
    var render_4, id, name, sceneDescs, sceneGroup;
    return {
        setters: [
            function (render_4_1) {
                render_4 = render_4_1;
            }
        ],
        execute: function () {
            id = "sm64ds";
            name = "Super Mario 64 DS";
            sceneDescs = [
                { 'id': 1, 'name': "Princess Peach's Castle - Gardens" },
                { 'id': 2, 'name': "Princess Peach's Castle - 1st Floor" },
                { 'id': 5, 'name': "Princess Peach's Castle - 2nd Floor" },
                { 'id': 4, 'name': "Princess Peach's Castle - Basement" },
                { 'id': 3, 'name': "Princess Peach's Castle - Courtyard" },
                { 'id': 50, 'name': "Princess Peach's Castle - Playroom" },
                { 'id': 6, 'name': 'Bob-omb Battlefield' },
                { 'id': 7, 'name': "Whomp's Fortress" },
                { 'id': 8, 'name': 'Jolly Roger Bay' },
                { 'id': 9, 'name': 'Jolly Roger Bay - Inside the Ship' },
                { 'id': 10, 'name': 'Cool, Cool Mountain' },
                { 'id': 11, 'name': 'Cool, Cool Mountain - Inside the Slide' },
                { 'id': 12, 'name': "Big Boo's Haunt" },
                { 'id': 13, 'name': 'Hazy Maze Cave' },
                { 'id': 14, 'name': 'Lethal Lava Land' },
                { 'id': 15, 'name': 'Lethal Lava Land - Inside the Volcano' },
                { 'id': 16, 'name': 'Shifting Sand Land' },
                { 'id': 17, 'name': 'Shifting Sand Land - Inside the Pyramid' },
                { 'id': 18, 'name': 'Dire, Dire Docks' },
                { 'id': 19, 'name': "Snowman's Land" },
                { 'id': 20, 'name': "Snowman's Land - Inside the Igloo" },
                { 'id': 21, 'name': 'Wet-Dry World' },
                { 'id': 22, 'name': 'Tall Tall Mountain' },
                { 'id': 23, 'name': 'Tall Tall Mountain - Inside the Slide' },
                { 'id': 25, 'name': 'Tiny-Huge Island - Tiny' },
                { 'id': 24, 'name': 'Tiny-Huge Island - Huge' },
                { 'id': 26, 'name': "Tiny-Huge Island - Inside Wiggler's Cavern" },
                { 'id': 27, 'name': 'Tick Tock Clock' },
                { 'id': 28, 'name': 'Rainbow Ride' },
                { 'id': 35, 'name': 'Bowser in the Dark World' },
                { 'id': 36, 'name': 'Bowser in the Dark World - Battle' },
                { 'id': 37, 'name': 'Bowser in the Fire Sea' },
                { 'id': 38, 'name': 'Bowser in the Fire Sea - Battle' },
                { 'id': 39, 'name': 'Bowser in the Sky' },
                { 'id': 40, 'name': 'Bowser in the Sky - Battle' },
                { 'id': 29, 'name': 'The Princess\'s Secret Slide' },
                { 'id': 30, 'name': 'The Secret Aquarium' },
                { 'id': 34, 'name': 'Wing Mario over the Rainbow' },
                { 'id': 31, 'name': 'Tower of the Wing Cap' },
                { 'id': 32, 'name': 'Vanish Cap Under the Moat' },
                { 'id': 33, 'name': 'Cavern of the Metal Cap' },
                { 'id': 46, 'name': 'Big Boo Battle' },
                { 'id': 47, 'name': 'Big Boo Battle - Battle' },
                { 'id': 44, 'name': 'Goomboss Battle' },
                { 'id': 45, 'name': 'Goomboss Battle - Battle' },
                { 'id': 48, 'name': 'Chief Chilly Challenge' },
                { 'id': 49, 'name': 'Chief Chilly Challenge - Battle' },
                { 'id': 42, 'name': 'VS Map - The Secret of Battle Fort' },
                { 'id': 43, 'name': 'VS Map - Sunshine Isles' },
                { 'id': 51, 'name': 'VS Map - Castle Gardens' },
                { 'id': 0, 'name': 'Test Map A' },
                { 'id': 41, 'name': 'Test Map B' },
            ].map(function (entry) {
                return new render_4.SceneDesc(entry.name, entry.id);
            });
            exports_22("sceneGroup", sceneGroup = { id: id, name: name, sceneDescs: sceneDescs });
        }
    };
});
System.register("zelview/f3dex2", ["gl-matrix"], function (exports_23, context_23) {
    "use strict";
    var __moduleName = context_23 && context_23.id;
    function readVertex(state, which, addr) {
        var rom = state.rom;
        var offs = state.lookupAddress(addr);
        var posX = rom.view.getInt16(offs + 0, false);
        var posY = rom.view.getInt16(offs + 2, false);
        var posZ = rom.view.getInt16(offs + 4, false);
        var pos = gl_matrix_4.vec3.clone([posX, posY, posZ]);
        gl_matrix_4.vec3.transformMat4(pos, pos, state.mtx);
        var txU = rom.view.getInt16(offs + 8, false) * (1 / 32);
        var txV = rom.view.getInt16(offs + 10, false) * (1 / 32);
        var vtxArray = new Float32Array(state.vertexBuffer.buffer, which * VERTEX_BYTES, VERTEX_SIZE);
        vtxArray[0] = pos[0];
        vtxArray[1] = pos[1];
        vtxArray[2] = pos[2];
        vtxArray[3] = txU;
        vtxArray[4] = txV;
        vtxArray[5] = rom.view.getUint8(offs + 12) / 255;
        vtxArray[6] = rom.view.getUint8(offs + 13) / 255;
        vtxArray[7] = rom.view.getUint8(offs + 14) / 255;
        vtxArray[8] = rom.view.getUint8(offs + 15) / 255;
    }
    function cmd_VTX(state, w0, w1) {
        var N = (w0 >> 12) & 0xFF;
        var V0 = ((w0 >> 1) & 0x7F) - N;
        var addr = w1;
        for (var i = 0; i < N; i++) {
            var which = V0 + i;
            readVertex(state, which, addr);
            addr += 16;
            state.verticesDirty[which] = true;
        }
    }
    function translateTRI(state, idxData) {
        var gl = state.gl;
        function anyVertsDirty() {
            try {
                for (var idxData_1 = __values(idxData), idxData_1_1 = idxData_1.next(); !idxData_1_1.done; idxData_1_1 = idxData_1.next()) {
                    var idx = idxData_1_1.value;
                    if (state.verticesDirty[idx])
                        return true;
                }
            }
            catch (e_13_1) { e_13 = { error: e_13_1 }; }
            finally {
                try {
                    if (idxData_1_1 && !idxData_1_1.done && (_a = idxData_1.return)) _a.call(idxData_1);
                }
                finally { if (e_13) throw e_13.error; }
            }
            return false;
            var e_13, _a;
        }
        function createGLVertBuffer() {
            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, state.vertexBuffer, gl.STATIC_DRAW);
            return vertBuffer;
        }
        function getVertexBufferGL() {
            if (anyVertsDirty() || !state.vertexBufferGL) {
                state.vertexBufferGL = createGLVertBuffer();
                state.verticesDirty = [];
            }
            return state.vertexBufferGL;
        }
        var vertBuffer = getVertexBufferGL();
        var idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);
        var nPrim = idxData.length;
        return function drawTri(renderState) {
            var prog = renderState.currentProgram;
            var gl = renderState.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
            gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
            gl.vertexAttribPointer(prog.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 5 * Float32Array.BYTES_PER_ELEMENT);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.enableVertexAttribArray(prog.colorLocation);
            gl.enableVertexAttribArray(prog.uvLocation);
            gl.drawElements(gl.TRIANGLES, nPrim, gl.UNSIGNED_BYTE, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
            gl.disableVertexAttribArray(prog.uvLocation);
            gl.disableVertexAttribArray(prog.colorLocation);
        };
    }
    function tri(idxData, offs, cmd) {
        idxData[offs + 0] = (cmd >> 17) & 0x7F;
        idxData[offs + 1] = (cmd >> 9) & 0x7F;
        idxData[offs + 2] = (cmd >> 1) & 0x7F;
    }
    function flushTexture(state) {
        if (state.textureTile)
            loadTile(state, state.textureTile);
    }
    function cmd_TRI1(state, w0, w1) {
        flushTexture(state);
        var idxData = new Uint8Array(3);
        tri(idxData, 0, w0);
        state.cmds.push(translateTRI(state, idxData));
    }
    function cmd_TRI2(state, w0, w1) {
        flushTexture(state);
        var idxData = new Uint8Array(6);
        tri(idxData, 0, w0);
        tri(idxData, 3, w1);
        state.cmds.push(translateTRI(state, idxData));
    }
    function syncGeometryMode(renderState, newMode) {
        var gl = renderState.gl;
        var cullFront = newMode & GeometryMode.CULL_FRONT;
        var cullBack = newMode & GeometryMode.CULL_BACK;
        if (cullFront && cullBack)
            gl.cullFace(gl.FRONT_AND_BACK);
        else if (cullFront)
            gl.cullFace(gl.FRONT);
        else if (cullBack)
            gl.cullFace(gl.BACK);
        if (cullFront || cullBack)
            gl.enable(gl.CULL_FACE);
        else
            gl.disable(gl.CULL_FACE);
        var lighting = newMode & GeometryMode.LIGHTING;
        var useVertexColors = !lighting;
        var prog = renderState.currentProgram;
        gl.uniform1i(prog.useVertexColorsLocation, useVertexColors);
    }
    function cmd_GEOMETRYMODE(state, w0, w1) {
        state.geometryMode = state.geometryMode & ((~w0) & 0x00FFFFFF) | w1;
        var newMode = state.geometryMode;
        state.cmds.push(function (renderState) {
            return syncGeometryMode(renderState, newMode);
        });
    }
    function syncRenderMode(renderState, newMode) {
        var gl = renderState.gl;
        var prog = renderState.currentProgram;
        if (newMode & OtherModeL.Z_CMP)
            gl.enable(gl.DEPTH_TEST);
        else
            gl.disable(gl.DEPTH_TEST);
        if (newMode & OtherModeL.Z_UPD)
            gl.depthMask(true);
        else
            gl.depthMask(false);
        var alphaTestMode;
        if (newMode & OtherModeL.FORCE_BL) {
            alphaTestMode = 0;
            gl.enable(gl.BLEND);
            // XXX: additional blend funcs?
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        else {
            alphaTestMode = ((newMode & OtherModeL.CVG_X_ALPHA) ? 0x1 : 0 |
                (newMode & OtherModeL.ALPHA_CVG_SEL) ? 0x2 : 0);
            gl.disable(gl.BLEND);
        }
        if (newMode & OtherModeL.ZMODE_DEC) {
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(-0.5, -0.5);
        }
        else {
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }
        gl.uniform1i(prog.alphaTestLocation, alphaTestMode);
    }
    function cmd_SETOTHERMODE_L(state, w0, w1) {
        state.cmds.push(function (renderState) {
            var mode = 31 - (w0 & 0xFF);
            if (mode === 3)
                return syncRenderMode(renderState, w1);
        });
    }
    function cmd_DL(state, w0, w1) {
        runDL(state, w1);
    }
    function cmd_MTX(state, w0, w1) {
        if (w1 & 0x80000000)
            state.mtx = state.mtxStack.pop();
        w1 &= ~0x80000000;
        state.geometryMode = 0;
        state.otherModeL = 0;
        state.mtxStack.push(state.mtx);
        state.mtx = gl_matrix_4.mat4.clone(state.mtx);
        var rom = state.rom;
        var offs = state.lookupAddress(w1);
        var mtx = gl_matrix_4.mat4.create();
        for (var x = 0; x < 4; x++) {
            for (var y = 0; y < 4; y++) {
                var mt1 = rom.view.getUint16(offs, false);
                var mt2 = rom.view.getUint16(offs + 32, false);
                mtx[(x * 4) + y] = ((mt1 << 16) | (mt2)) * (1 / 0x10000);
                offs += 2;
            }
        }
        gl_matrix_4.mat4.multiply(state.mtx, state.mtx, mtx);
    }
    function cmd_POPMTX(state, w0, w1) {
        state.mtx = state.mtxStack.pop();
    }
    function cmd_TEXTURE(state, w0, w1) {
        var boundTexture = {};
        state.boundTexture = boundTexture;
        var s = w1 >> 16;
        var t = w1 & 0x0000FFFF;
        state.boundTexture.scaleS = (s + 1) / 0x10000;
        state.boundTexture.scaleT = (t + 1) / 0x10000;
    }
    function r5g5b5a1(dst, dstOffs, p) {
        var r, g, b, a;
        r = (p & 0xF800) >> 11;
        r = (r << (8 - 5)) | (r >> (10 - 8));
        g = (p & 0x07C0) >> 6;
        g = (g << (8 - 5)) | (g >> (10 - 8));
        b = (p & 0x003E) >> 1;
        b = (b << (8 - 5)) | (b >> (10 - 8));
        a = (p & 0x0001) ? 0xFF : 0x00;
        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    }
    function cmd_SETTIMG(state, w0, w1) {
        state.textureImage = {};
        state.textureImage.format = (w0 >> 21) & 0x7;
        state.textureImage.size = (w0 >> 19) & 0x3;
        state.textureImage.width = (w0 & 0x1000) + 1;
        state.textureImage.addr = w1;
    }
    function cmd_SETTILE(state, w0, w1) {
        state.tile = {};
        var tile = state.tile;
        tile.format = (w0 >> 16) & 0xFF;
        tile.cms = (w1 >> 8) & 0x3;
        tile.cmt = (w1 >> 18) & 0x3;
        tile.tmem = w0 & 0x1FF;
        tile.lineSize = (w0 >> 9) & 0x1FF;
        tile.palette = (w1 >> 20) & 0xF;
        tile.shiftS = w1 & 0xF;
        tile.shiftT = (w1 >> 10) & 0xF;
        tile.maskS = (w1 >> 4) & 0xF;
        tile.maskT = (w1 >> 14) & 0xF;
    }
    function cmd_SETTILESIZE(state, w0, w1) {
        var tileIdx = (w1 >> 24) & 0x7;
        var tile = state.tile;
        tile.uls = (w0 >> 14) & 0x3FF;
        tile.ult = (w0 >> 2) & 0x3FF;
        tile.lrs = (w1 >> 14) & 0x3FF;
        tile.lrt = (w1 >> 2) & 0x3FF;
    }
    function cmd_LOADTLUT(state, w0, w1) {
        var rom = state.rom;
        // XXX: properly implement uls/ult/lrs/lrt
        var size = ((w1 & 0x00FFF000) >> 14) + 1;
        var dst = new Uint8Array(size * 4);
        var srcOffs = state.lookupAddress(state.textureImage.addr);
        var dstOffs = 0;
        for (var i = 0; i < size; i++) {
            var pixel = rom.view.getUint16(srcOffs, false);
            r5g5b5a1(dst, dstOffs, pixel);
            srcOffs += 2;
            dstOffs += 4;
        }
        state.paletteTile = state.tile;
        state.paletteTile.pixels = dst;
    }
    function tileCacheKey(state, tile) {
        // XXX: Do we need more than this?
        var srcOffs = state.lookupAddress(tile.addr);
        return srcOffs;
    }
    function loadTile(state, tile) {
        if (tile.textureId)
            return;
        var key = tileCacheKey(state, tile);
        var otherTile = tileCache[key];
        if (!otherTile) {
            translateTexture(state, tile);
            tileCache[key] = tile;
        }
        else if (tile !== otherTile) {
            tile.textureId = otherTile.textureId;
            tile.width = otherTile.width;
            tile.height = otherTile.height;
            tile.wrapS = otherTile.wrapS;
            tile.wrapT = otherTile.wrapT;
        }
    }
    function convert_CI4(state, texture) {
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b = state.rom.view.getUint8(srcOffs++);
                var idx = void 0;
                idx = ((b & 0xF0) >> 4) * 4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                idx = (b & 0x0F) * 4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
            }
        }
        texture.pixels = dst;
    }
    function convert_I4(state, texture) {
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b = state.rom.view.getUint8(srcOffs++);
                var p = void 0;
                p = (b & 0xF0) >> 4;
                p = p << 4 | p;
                dst[i++] = p;
                dst[i++] = p;
                p = (b & 0x0F);
                p = p << 4 | p;
                dst[i++] = p;
                dst[i++] = p;
            }
        }
        texture.pixels = dst;
    }
    function convert_IA4(state, texture) {
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b = state.rom.view.getUint8(srcOffs++);
                var p = void 0;
                var pm = void 0;
                p = (b & 0xF0) >> 4;
                pm = p & 0x0E;
                dst[i++] = (pm << 4 | pm);
                dst[i++] = (p & 0x01) ? 0xFF : 0x00;
                p = (b & 0x0F);
                pm = p & 0x0E;
                dst[i++] = (pm << 4 | pm);
                dst[i++] = (p & 0x01) ? 0xFF : 0x00;
            }
        }
        texture.pixels = dst;
    }
    function convert_CI8(state, texture) {
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var idx = state.rom.view.getUint8(srcOffs) * 4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                srcOffs++;
            }
        }
        texture.pixels = dst;
    }
    function convert_I8(state, texture) {
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var p = state.rom.view.getUint8(srcOffs++);
                dst[i++] = p;
                dst[i++] = p;
            }
        }
        texture.pixels = dst;
    }
    function convert_IA8(state, texture) {
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var b = state.rom.view.getUint8(srcOffs++);
                var p = void 0;
                p = (b & 0xF0) >> 4;
                p = p << 4 | p;
                dst[i++] = p;
                p = (b & 0x0F);
                p = p >> 4 | p;
                dst[i++] = p;
            }
        }
        texture.pixels = dst;
    }
    function convert_RGBA16(state, texture) {
        var rom = state.rom;
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var pixel = rom.view.getUint16(srcOffs, false);
                r5g5b5a1(dst, i, pixel);
                i += 4;
                srcOffs += 2;
            }
        }
        texture.pixels = dst;
    }
    function convert_IA16(state, texture) {
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var srcOffs = state.lookupAddress(texture.addr);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                dst[i++] = state.rom.view.getUint8(srcOffs++);
                dst[i++] = state.rom.view.getUint8(srcOffs++);
            }
        }
        texture.pixels = dst;
    }
    function textureToCanvas(texture) {
        var canvas = document.createElement("canvas");
        canvas.width = texture.width;
        canvas.height = texture.height;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);
        if (texture.dstFormat === "i8") {
            for (var si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
                imgData.data[di + 0] = texture.pixels[si];
                imgData.data[di + 1] = texture.pixels[si];
                imgData.data[di + 2] = texture.pixels[si];
                imgData.data[di + 3] = 255;
            }
        }
        else if (texture.dstFormat === "i8_a8") {
            for (var si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
                imgData.data[di + 0] = texture.pixels[si];
                imgData.data[di + 1] = texture.pixels[si];
                imgData.data[di + 2] = texture.pixels[si];
                imgData.data[di + 3] = texture.pixels[si + 1];
            }
        }
        else if (texture.dstFormat === "rgba8") {
            for (var i = 0; i < imgData.data.length; i++)
                imgData.data[i] = texture.pixels[i];
        }
        canvas.title = '0x' + texture.addr.toString(16) + '  ' + texture.format.toString(16) + '  ' + texture.dstFormat;
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }
    function translateTexture(state, texture) {
        var gl = state.gl;
        calcTextureSize(texture);
        function convertTexturePixels() {
            switch (texture.format) {
                // 4-bit
                case 0x40: return convert_CI4(state, texture); // CI
                case 0x60: return convert_IA4(state, texture); // IA
                case 0x80: return convert_I4(state, texture); // I
                // 8-bit
                case 0x48: return convert_CI8(state, texture); // CI
                case 0x68: return convert_IA8(state, texture); // IA
                case 0x88: return convert_I8(state, texture); // I
                // 16-bit
                case 0x10: return convert_RGBA16(state, texture); // RGBA
                case 0x70: return convert_IA16(state, texture); // IA
                default: console.error("Unsupported texture", texture.format.toString(16));
            }
        }
        texture.dstFormat = calcTextureDestFormat(texture);
        var srcOffs = state.lookupAddress(texture.addr);
        if (srcOffs !== null)
            convertTexturePixels();
        if (!texture.pixels) {
            if (texture.dstFormat === "i8")
                texture.pixels = new Uint8Array(texture.width * texture.height);
            else if (texture.dstFormat === "i8_a8")
                texture.pixels = new Uint8Array(texture.width * texture.height * 2);
            else if (texture.dstFormat === "rgba8")
                texture.pixels = new Uint8Array(texture.width * texture.height * 4);
        }
        function translateWrap(cm) {
            switch (cm) {
                case 1: return gl.MIRRORED_REPEAT;
                case 2: return gl.CLAMP_TO_EDGE;
                case 3: return gl.CLAMP_TO_EDGE;
                default: return gl.REPEAT;
            }
        }
        texture.wrapT = translateWrap(texture.cmt);
        texture.wrapS = translateWrap(texture.cms);
        var texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        var glFormat;
        if (texture.dstFormat === "i8")
            glFormat = gl.LUMINANCE;
        else if (texture.dstFormat === "i8_a8")
            glFormat = gl.LUMINANCE_ALPHA;
        else if (texture.dstFormat === "rgba8")
            glFormat = gl.RGBA;
        gl.texImage2D(gl.TEXTURE_2D, 0, glFormat, texture.width, texture.height, 0, glFormat, gl.UNSIGNED_BYTE, texture.pixels);
        texture.textureId = texId;
        state.textures.push(textureToCanvas(texture));
    }
    function calcTextureDestFormat(texture) {
        switch (texture.format & 0xE0) {
            case 0x00: return "rgba8"; // RGBA
            case 0x40: return "rgba8"; // CI -- XXX -- do we need to check the palette type?
            case 0x60: return "i8_a8"; // IA
            case 0x80: return "i8_a8"; // I
            default: throw new Error("Invalid texture type");
        }
    }
    function calcTextureSize(texture) {
        var maxTexel, lineShift;
        switch (texture.format) {
            // 4-bit
            case 0x00:
                maxTexel = 4096;
                lineShift = 4;
                break; // RGBA
            case 0x40:
                maxTexel = 4096;
                lineShift = 4;
                break; // CI
            case 0x60:
                maxTexel = 8196;
                lineShift = 4;
                break; // IA
            case 0x80:
                maxTexel = 8196;
                lineShift = 4;
                break; // I
            // 8-bit
            case 0x08:
                maxTexel = 2048;
                lineShift = 3;
                break; // RGBA
            case 0x48:
                maxTexel = 2048;
                lineShift = 3;
                break; // CI
            case 0x68:
                maxTexel = 4096;
                lineShift = 3;
                break; // IA
            case 0x88:
                maxTexel = 4096;
                lineShift = 3;
                break; // I
            // 16-bit
            case 0x10:
                maxTexel = 2048;
                lineShift = 2;
                break; // RGBA
            case 0x50:
                maxTexel = 2048;
                lineShift = 0;
                break; // CI
            case 0x70:
                maxTexel = 2048;
                lineShift = 2;
                break; // IA
            case 0x90:
                maxTexel = 2048;
                lineShift = 0;
                break; // I
            // 32-bit
            case 0x18:
                maxTexel = 1024;
                lineShift = 2;
                break; // RGBA
        }
        var lineW = texture.lineSize << lineShift;
        texture.rowStride = lineW;
        var tileW = texture.lrs - texture.uls + 1;
        var tileH = texture.lrt - texture.ult + 1;
        var maskW = 1 << texture.maskS;
        var maskH = 1 << texture.maskT;
        var lineH;
        if (lineW > 0)
            lineH = Math.min(maxTexel / lineW, tileH);
        else
            lineH = 0;
        var width;
        if (texture.maskS > 0 && (maskW * maskH) <= maxTexel)
            width = maskW;
        else if ((tileW * tileH) <= maxTexel)
            width = tileW;
        else
            width = lineW;
        var height;
        if (texture.maskT > 0 && (maskW * maskH) <= maxTexel)
            height = maskH;
        else if ((tileW * tileH) <= maxTexel)
            height = tileH;
        else
            height = lineH;
        texture.width = width;
        texture.height = height;
    }
    function loadTextureBlock(state, cmds) {
        var tileIdx = (cmds[5][1] >> 24) & 0x7;
        if (tileIdx !== 0)
            return;
        cmd_SETTIMG(state, cmds[0][0], cmds[0][1]);
        cmd_SETTILE(state, cmds[5][0], cmds[5][1]);
        cmd_SETTILESIZE(state, cmds[6][0], cmds[6][1]);
        var tile = state.tile;
        state.textureTile = tile;
        tile.addr = state.textureImage.addr;
        state.cmds.push(function (renderState) {
            var gl = renderState.gl;
            if (!tile.textureId)
                return;
            gl.bindTexture(gl.TEXTURE_2D, tile.textureId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, tile.wrapS);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, tile.wrapT);
            var prog = renderState.currentProgram;
            gl.uniform2fv(prog.txsLocation, [1 / tile.width, 1 / tile.height]);
        });
    }
    function runDL(state, addr) {
        function collectNextCmds() {
            var L = [];
            var voffs = offs;
            for (var i = 0; i < 8; i++) {
                var cmd0 = rom.view.getUint32(voffs, false);
                var cmd1 = rom.view.getUint32(voffs + 4, false);
                L.push([cmd0, cmd1]);
                voffs += 8;
            }
            return L;
        }
        function matchesCmdStream(cmds, needle) {
            for (var i = 0; i < needle.length; i++)
                if (cmds[i][0] >>> 24 !== needle[i])
                    return false;
            return true;
        }
        var rom = state.rom;
        var offs = state.lookupAddress(addr);
        if (offs === null)
            return;
        while (true) {
            var cmd0 = rom.view.getUint32(offs, false);
            var cmd1 = rom.view.getUint32(offs + 4, false);
            var cmdType = cmd0 >>> 24;
            if (cmdType === UCodeCommands.ENDDL)
                break;
            // Texture uploads need to be special.
            if (cmdType === UCodeCommands.SETTIMG) {
                var U = UCodeCommands;
                var nextCmds = collectNextCmds();
                if (matchesCmdStream(nextCmds, [U.SETTIMG, U.SETTILE, U.RDPLOADSYNC, U.LOADBLOCK, U.RDPPIPESYNC, U.SETTILE, U.SETTILESIZE])) {
                    loadTextureBlock(state, nextCmds);
                    offs += 7 * 8;
                    continue;
                }
            }
            var func = CommandDispatch[cmdType];
            if (func)
                func(state, cmd0, cmd1);
            offs += 8;
        }
    }
    function readDL(gl, rom, banks, startAddr) {
        var state = new State();
        state.gl = gl;
        state.cmds = [];
        state.textures = [];
        state.mtx = gl_matrix_4.mat4.create();
        state.mtxStack = [state.mtx];
        state.vertexBuffer = new Float32Array(32 * VERTEX_SIZE);
        state.verticesDirty = [];
        state.paletteTile = {};
        state.rom = rom;
        state.banks = banks;
        runDL(state, startAddr);
        return new DL(state.cmds, state.textures);
    }
    exports_23("readDL", readDL);
    var gl_matrix_4, UCodeCommands, VERTEX_SIZE, VERTEX_BYTES, GeometryMode, OtherModeL, tileCache, CommandDispatch, F3DEX2, DL, State;
    return {
        setters: [
            function (gl_matrix_4_1) {
                gl_matrix_4 = gl_matrix_4_1;
            }
        ],
        execute: function () {
            UCodeCommands = {
                VTX: 0x01,
                TRI1: 0x05,
                TRI2: 0x06,
                GEOMETRYMODE: 0xD9,
                SETOTHERMODE_L: 0xE2,
                SETOTHERMODE_H: 0xE3,
                DL: 0xDE,
                ENDDL: 0xDF,
                MTX: 0xDA,
                POPMTX: 0xD8,
                TEXTURE: 0xD7,
                LOADTLUT: 0xF0,
                LOADBLOCK: 0xF3,
                SETTILESIZE: 0xF2,
                SETTILE: 0xF5,
                SETPRIMCOLOR: 0xF9,
                SETENVCOLOR: 0xFB,
                SETCOMBINE: 0xFC,
                SETTIMG: 0xFD,
                RDPLOADSYNC: 0xE6,
                RDPPIPESYNC: 0xE7,
            };
            // Latest TypeScript broke for...in: https://github.com/Microsoft/TypeScript/issues/19203
            /*
            var UCodeNames = {};
            for (var name in UCodeCommands)
                UCodeNames[UCodeCommands[name]] = name;
            */
            // 3 pos + 2 uv + 4 color/nrm
            VERTEX_SIZE = 9;
            VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
            GeometryMode = {
                CULL_FRONT: 0x0200,
                CULL_BACK: 0x0400,
                LIGHTING: 0x020000,
            };
            OtherModeL = {
                Z_CMP: 0x0010,
                Z_UPD: 0x0020,
                ZMODE_DEC: 0x0C00,
                CVG_X_ALPHA: 0x1000,
                ALPHA_CVG_SEL: 0x2000,
                FORCE_BL: 0x4000,
            };
            // XXX: This is global to cut down on resources between DLs.
            tileCache = {};
            CommandDispatch = {};
            CommandDispatch[UCodeCommands.VTX] = cmd_VTX;
            CommandDispatch[UCodeCommands.TRI1] = cmd_TRI1;
            CommandDispatch[UCodeCommands.TRI2] = cmd_TRI2;
            CommandDispatch[UCodeCommands.GEOMETRYMODE] = cmd_GEOMETRYMODE;
            CommandDispatch[UCodeCommands.DL] = cmd_DL;
            CommandDispatch[UCodeCommands.MTX] = cmd_MTX;
            CommandDispatch[UCodeCommands.POPMTX] = cmd_POPMTX;
            CommandDispatch[UCodeCommands.SETOTHERMODE_L] = cmd_SETOTHERMODE_L;
            CommandDispatch[UCodeCommands.LOADTLUT] = cmd_LOADTLUT;
            CommandDispatch[UCodeCommands.TEXTURE] = cmd_TEXTURE;
            CommandDispatch[UCodeCommands.SETTIMG] = cmd_SETTIMG;
            CommandDispatch[UCodeCommands.SETTILE] = cmd_SETTILE;
            CommandDispatch[UCodeCommands.SETTILESIZE] = cmd_SETTILESIZE;
            F3DEX2 = {};
            DL = /** @class */ (function () {
                function DL(cmds, textures) {
                    this.cmds = cmds;
                    this.textures = textures;
                }
                return DL;
            }());
            exports_23("DL", DL);
            State = /** @class */ (function () {
                function State() {
                }
                State.prototype.lookupAddress = function (addr) {
                    return this.rom.lookupAddress(this.banks, addr);
                };
                return State;
            }());
        }
    };
});
System.register("zelview/zelview0", ["gl-matrix", "zelview/f3dex2"], function (exports_24, context_24) {
    "use strict";
    var __moduleName = context_24 && context_24.id;
    // Loads the ZELVIEW0 format.
    function read0String(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var L = new Array(length);
        for (var i = 0; i < length; i++) {
            var elem = buf[i];
            if (elem === 0)
                break;
            L.push(String.fromCharCode(elem));
        }
        return L.join('');
    }
    function readZELVIEW0(buffer) {
        var view = new DataView(buffer);
        var MAGIC = "ZELVIEW0";
        if (read0String(buffer, 0, MAGIC.length) !== MAGIC)
            throw new Error("Invalid ZELVIEW0 file");
        var offs = 0x08;
        var count = view.getUint8(offs);
        offs += 0x04;
        var mainFile = view.getUint8(offs);
        offs += 0x04;
        function readVFSEntry() {
            var entry = new VFSEntry();
            entry.filename = read0String(buffer, offs, 0x30);
            offs += 0x30;
            entry.pStart = view.getUint32(offs, true);
            entry.pEnd = view.getUint32(offs + 0x04, true);
            entry.vStart = view.getUint32(offs + 0x08, true);
            entry.vEnd = view.getUint32(offs + 0x0C, true);
            offs += 0x10;
            return entry;
        }
        var entries = [];
        for (var i = 0; i < count; i++)
            entries.push(readVFSEntry());
        var zelview0 = new ZELVIEW0();
        zelview0.entries = entries;
        zelview0.sceneFile = entries[mainFile];
        zelview0.view = view;
        return zelview0;
    }
    exports_24("readZELVIEW0", readZELVIEW0);
    function readHeaders(gl, rom, offs, banks) {
        var headers = new Headers();
        function loadAddress(addr) {
            return rom.loadAddress(banks, addr);
        }
        function readCollision(collisionAddr) {
            var offs = rom.lookupAddress(banks, collisionAddr);
            function readVerts(N, addr) {
                var offs = rom.lookupAddress(banks, addr);
                var verts = new Uint16Array(N * 3);
                for (var i = 0; i < N; i++) {
                    verts[i * 3 + 0] = rom.view.getInt16(offs + 0x00, false);
                    verts[i * 3 + 1] = rom.view.getInt16(offs + 0x02, false);
                    verts[i * 3 + 2] = rom.view.getInt16(offs + 0x04, false);
                    offs += 0x06;
                }
                return verts;
            }
            var vertsN = rom.view.getUint16(offs + 0x0C, false);
            var vertsAddr = rom.view.getUint32(offs + 0x10, false);
            var verts = readVerts(vertsN, vertsAddr);
            function readPolys(N, addr) {
                var offs = rom.lookupAddress(banks, addr);
                var polys = new Uint16Array(N * 3);
                for (var i = 0; i < N; i++) {
                    polys[i * 3 + 0] = rom.view.getUint16(offs + 0x02, false) & 0x0FFF;
                    polys[i * 3 + 1] = rom.view.getUint16(offs + 0x04, false) & 0x0FFF;
                    polys[i * 3 + 2] = rom.view.getUint16(offs + 0x06, false) & 0x0FFF;
                    offs += 0x10;
                }
                return polys;
            }
            var polysN = rom.view.getUint16(offs + 0x14, false);
            var polysAddr = rom.view.getUint32(offs + 0x18, false);
            var polys = readPolys(polysN, polysAddr);
            function readWaters(N, addr) {
                // XXX: While we should probably keep the actual stuff about
                // water boxes, I'm just drawing them, so let's just record
                // a quad.
                var offs = rom.lookupAddress(banks, addr);
                var waters = new Uint16Array(N * 3 * 4);
                for (var i = 0; i < N; i++) {
                    var x = rom.view.getInt16(offs + 0x00, false);
                    var y = rom.view.getInt16(offs + 0x02, false);
                    var z = rom.view.getInt16(offs + 0x04, false);
                    var sx = rom.view.getInt16(offs + 0x06, false);
                    var sz = rom.view.getInt16(offs + 0x08, false);
                    waters[i * 3 * 4 + 0] = x;
                    waters[i * 3 * 4 + 1] = y;
                    waters[i * 3 * 4 + 2] = z;
                    waters[i * 3 * 4 + 3] = x + sx;
                    waters[i * 3 * 4 + 4] = y;
                    waters[i * 3 * 4 + 5] = z;
                    waters[i * 3 * 4 + 6] = x;
                    waters[i * 3 * 4 + 7] = y;
                    waters[i * 3 * 4 + 8] = z + sz;
                    waters[i * 3 * 4 + 9] = x + sx;
                    waters[i * 3 * 4 + 10] = y;
                    waters[i * 3 * 4 + 11] = z + sz;
                    offs += 0x10;
                }
                return waters;
            }
            var watersN = rom.view.getUint16(offs + 0x24, false);
            var watersAddr = rom.view.getUint32(offs + 0x28, false);
            var waters = readWaters(watersN, watersAddr);
            function readCamera(addr) {
                var skyboxCamera = loadAddress(addr + 0x04);
                var offs = rom.lookupAddress(banks, skyboxCamera);
                var x = rom.view.getInt16(offs + 0x00, false);
                var y = rom.view.getInt16(offs + 0x02, false);
                var z = rom.view.getInt16(offs + 0x04, false);
                var a = rom.view.getUint16(offs + 0x06, false) / 0xFFFF * (Math.PI * 2);
                var b = rom.view.getUint16(offs + 0x08, false) / 0xFFFF * (Math.PI * 2) + Math.PI;
                var c = rom.view.getUint16(offs + 0x0A, false) / 0xFFFF * (Math.PI * 2);
                var d = rom.view.getUint16(offs + 0x0C, false);
                var mtx = gl_matrix_5.mat4.create();
                gl_matrix_5.mat4.translate(mtx, mtx, [x, y, z]);
                gl_matrix_5.mat4.rotateZ(mtx, mtx, c);
                gl_matrix_5.mat4.rotateY(mtx, mtx, b);
                gl_matrix_5.mat4.rotateX(mtx, mtx, -a);
                return mtx;
            }
            var cameraAddr = rom.view.getUint32(offs + 0x20, false);
            var camera = readCamera(cameraAddr);
            return { verts: verts, polys: polys, waters: waters, camera: camera };
        }
        function readRoom(file) {
            var banks2 = Object.create(banks);
            banks2.room = file;
            return readHeaders(gl, rom, file.vStart, banks2);
        }
        function readRooms(nRooms, roomTableAddr) {
            var rooms = [];
            for (var i = 0; i < nRooms; i++) {
                var pStart = loadAddress(roomTableAddr);
                var file = rom.lookupFile(pStart);
                var room = readRoom(file);
                room.filename = file.filename;
                rooms.push(room);
                roomTableAddr += 8;
            }
            return rooms;
        }
        function loadImage(gl, src) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var texId = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            var img = document.createElement('img');
            img.src = src;
            var aspect = 1;
            img.onload = function () {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgData.width, imgData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData.data);
            };
            // XXX: Should pull this dynamically at runtime.
            var imgWidth = 320;
            var imgHeight = 240;
            var imgAspect = imgWidth / imgHeight;
            var viewportAspect = gl.viewportWidth / gl.viewportHeight;
            var x = imgAspect / viewportAspect;
            var vertData = new Float32Array([
                /* x   y   z   u  v */
                -x, -1, 0, 0, 1,
                x, -1, 0, 1, 1,
                -x, 1, 0, 0, 0,
                x, 1, 0, 1, 0,
            ]);
            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.STATIC_DRAW);
            var idxData = new Uint8Array([
                0, 1, 2, 3,
            ]);
            var idxBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);
            // 3 pos + 2 uv
            var VERTEX_SIZE = 5;
            var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
            return function (renderState) {
                var gl = renderState.gl;
                var prog = renderState.currentProgram;
                gl.disable(gl.BLEND);
                gl.disable(gl.DEPTH_TEST);
                gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
                gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
                gl.enableVertexAttribArray(prog.positionLocation);
                gl.enableVertexAttribArray(prog.uvLocation);
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
                gl.disableVertexAttribArray(prog.positionLocation);
                gl.disableVertexAttribArray(prog.uvLocation);
            };
        }
        function readMesh(meshAddr) {
            var hdr = loadAddress(meshAddr);
            var type = (hdr >> 24);
            var nEntries = (hdr >> 16) & 0xFF;
            var entriesAddr = loadAddress(meshAddr + 4);
            var mesh = new Mesh();
            function readDL(addr) {
                var dlStart = loadAddress(addr);
                if (dlStart === 0)
                    return null;
                return F3DEX2.readDL(gl, rom, banks, dlStart);
            }
            if (type === 0) {
                for (var i = 0; i < nEntries; i++) {
                    mesh.opaque.push(readDL(entriesAddr));
                    mesh.transparent.push(readDL(entriesAddr + 4));
                    entriesAddr += 8;
                }
            }
            else if (type === 1) {
                // The last entry always seems to contain the BG. Not sure
                // what the other data is about... maybe the VR skybox for rotating scenes?
                var lastEntry = nEntries - 1;
                var bg = loadAddress(meshAddr + (lastEntry * 0x0C) + 0x08);
                var bgOffs = rom.lookupAddress(banks, bg);
                var buffer = rom.view.buffer.slice(bgOffs);
                var blob = new Blob([buffer], { type: 'image/jpeg' });
                var url = window.URL.createObjectURL(blob);
                mesh.bg = loadImage(gl, url);
            }
            else if (type === 2) {
                for (var i = 0; i < nEntries; i++) {
                    mesh.opaque.push(readDL(entriesAddr + 8));
                    mesh.transparent.push(readDL(entriesAddr + 12));
                    entriesAddr += 16;
                }
            }
            mesh.opaque = mesh.opaque.filter(function (dl) { return !!dl; });
            mesh.transparent = mesh.transparent.filter(function (dl) { return !!dl; });
            mesh.textures = [];
            mesh.opaque.forEach(function (dl) { mesh.textures = mesh.textures.concat(dl.textures); });
            mesh.transparent.forEach(function (dl) { mesh.textures = mesh.textures.concat(dl.textures); });
            return mesh;
        }
        headers.rooms = [];
        headers.mesh = null;
        var startOffs = offs;
        while (true) {
            var cmd1 = rom.view.getUint32(offs, false);
            var cmd2 = rom.view.getUint32(offs + 4, false);
            offs += 8;
            var cmdType = cmd1 >> 24;
            if (cmdType === HeaderCommands.End)
                break;
            switch (cmdType) {
                case HeaderCommands.Collision:
                    headers.collision = readCollision(cmd2);
                    break;
                case HeaderCommands.Rooms:
                    var nRooms = (cmd1 >> 16) & 0xFF;
                    headers.rooms = readRooms(nRooms, cmd2);
                    break;
                case HeaderCommands.Mesh:
                    headers.mesh = readMesh(cmd2);
                    break;
            }
        }
        return headers;
    }
    function readScene(gl, zelview0, file) {
        var banks = { scene: file };
        return readHeaders(gl, zelview0, file.vStart, banks);
    }
    var gl_matrix_5, F3DEX2, VFSEntry, ZELVIEW0, Mesh, Headers, HeaderCommands;
    return {
        setters: [
            function (gl_matrix_5_1) {
                gl_matrix_5 = gl_matrix_5_1;
            },
            function (F3DEX2_1) {
                F3DEX2 = F3DEX2_1;
            }
        ],
        execute: function () {
            VFSEntry = /** @class */ (function () {
                function VFSEntry() {
                }
                return VFSEntry;
            }());
            ZELVIEW0 = /** @class */ (function () {
                function ZELVIEW0() {
                }
                ZELVIEW0.prototype.lookupFile = function (pStart) {
                    try {
                        for (var _a = __values(this.entries), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var entry = _b.value;
                            if (entry.pStart === pStart)
                                return entry;
                        }
                    }
                    catch (e_14_1) { e_14 = { error: e_14_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_14) throw e_14.error; }
                    }
                    return null;
                    var e_14, _c;
                };
                ZELVIEW0.prototype.lookupAddress = function (banks, addr) {
                    var bankIdx = addr >>> 24;
                    var offs = addr & 0x00FFFFFF;
                    function findBank() {
                        switch (bankIdx) {
                            case 0x02: return banks.scene;
                            case 0x03: return banks.room;
                            default: return null;
                        }
                    }
                    var bank = findBank();
                    if (bank === null)
                        return null;
                    var absOffs = bank.vStart + offs;
                    if (absOffs > bank.vEnd)
                        return null;
                    return absOffs;
                };
                ZELVIEW0.prototype.loadAddress = function (banks, addr) {
                    var offs = this.lookupAddress(banks, addr);
                    return this.view.getUint32(offs);
                };
                ZELVIEW0.prototype.loadScene = function (gl, scene) {
                    return readScene(gl, this, scene);
                };
                ZELVIEW0.prototype.loadMainScene = function (gl) {
                    return this.loadScene(gl, this.sceneFile);
                };
                return ZELVIEW0;
            }());
            exports_24("ZELVIEW0", ZELVIEW0);
            Mesh = /** @class */ (function () {
                function Mesh() {
                    this.opaque = [];
                    this.transparent = [];
                }
                return Mesh;
            }());
            Headers = /** @class */ (function () {
                function Headers() {
                    this.rooms = [];
                }
                return Headers;
            }());
            exports_24("Headers", Headers);
            (function (HeaderCommands) {
                HeaderCommands[HeaderCommands["Spawns"] = 0] = "Spawns";
                HeaderCommands[HeaderCommands["Actors"] = 1] = "Actors";
                HeaderCommands[HeaderCommands["Camera"] = 2] = "Camera";
                HeaderCommands[HeaderCommands["Collision"] = 3] = "Collision";
                HeaderCommands[HeaderCommands["Rooms"] = 4] = "Rooms";
                HeaderCommands[HeaderCommands["WindSettings"] = 5] = "WindSettings";
                HeaderCommands[HeaderCommands["EntranceList"] = 6] = "EntranceList";
                HeaderCommands[HeaderCommands["SpecialObjects"] = 7] = "SpecialObjects";
                HeaderCommands[HeaderCommands["SpecialBehavior"] = 8] = "SpecialBehavior";
                // 0x09 is unknown
                HeaderCommands[HeaderCommands["Mesh"] = 10] = "Mesh";
                HeaderCommands[HeaderCommands["Objects"] = 11] = "Objects";
                // 0x0C is unused
                HeaderCommands[HeaderCommands["Waypoints"] = 13] = "Waypoints";
                HeaderCommands[HeaderCommands["Transitions"] = 14] = "Transitions";
                HeaderCommands[HeaderCommands["Environment"] = 15] = "Environment";
                HeaderCommands[HeaderCommands["Time"] = 16] = "Time";
                HeaderCommands[HeaderCommands["Skybox"] = 17] = "Skybox";
                HeaderCommands[HeaderCommands["End"] = 20] = "End";
            })(HeaderCommands || (HeaderCommands = {}));
        }
    };
});
System.register("zelview/render", ["viewer", "zelview/zelview0", "util"], function (exports_25, context_25) {
    "use strict";
    var __moduleName = context_25 && context_25.id;
    var Viewer, ZELVIEW0, util_12, BillboardBGProgram, F3DEX2Program, CollisionProgram, WaterboxProgram, Scene, SceneDesc;
    return {
        setters: [
            function (Viewer_5) {
                Viewer = Viewer_5;
            },
            function (ZELVIEW0_1) {
                ZELVIEW0 = ZELVIEW0_1;
            },
            function (util_12_1) {
                util_12 = util_12_1;
            }
        ],
        execute: function () {
            BillboardBGProgram = /** @class */ (function (_super) {
                __extends(BillboardBGProgram, _super);
                function BillboardBGProgram() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nattribute vec3 a_position;\nattribute vec2 a_uv;\nvarying vec2 v_uv;\n\nvoid main() {\n    gl_Position = vec4(a_position, 1.0);\n    v_uv = a_uv;\n}\n";
                    _this.frag = "\nprecision mediump float;\nvarying vec2 v_uv;\nuniform sampler2D u_texture;\n\nvoid main() {\n    gl_FragColor = texture2D(u_texture, v_uv);\n}\n";
                    return _this;
                }
                BillboardBGProgram.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return BillboardBGProgram;
            }(Viewer.Program));
            F3DEX2Program = /** @class */ (function (_super) {
                __extends(F3DEX2Program, _super);
                function F3DEX2Program() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\nattribute vec3 a_position;\nattribute vec2 a_uv;\nattribute vec4 a_color;\nvarying vec4 v_color;\nvarying vec2 v_uv;\nuniform vec2 u_txs;\n\nvoid main() {\n    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n    v_color = a_color;\n    v_uv = a_uv * u_txs;\n}\n";
                    _this.frag = "\nprecision mediump float;\nvarying vec2 v_uv;\nvarying vec4 v_color;\nuniform sampler2D u_texture;\nuniform bool u_useVertexColors;\nuniform int u_alphaTest;\n\nvoid main() {\n    gl_FragColor = texture2D(u_texture, v_uv);\n    if (u_useVertexColors)\n        gl_FragColor *= v_color;\n    if (u_alphaTest > 0 && gl_FragColor.a < 0.0125)\n        discard;\n}\n";
                    return _this;
                }
                F3DEX2Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.txsLocation = gl.getUniformLocation(prog, "u_txs");
                    this.useVertexColorsLocation = gl.getUniformLocation(prog, "u_useVertexColors");
                    this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.colorLocation = gl.getAttribLocation(prog, "a_color");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return F3DEX2Program;
            }(Viewer.Program));
            exports_25("F3DEX2Program", F3DEX2Program);
            CollisionProgram = /** @class */ (function (_super) {
                __extends(CollisionProgram, _super);
                function CollisionProgram() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\nattribute vec3 a_position;\n\nvoid main() {\n    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n}\n";
                    _this.frag = "\n#extension GL_EXT_frag_depth : enable\n\nvoid main() {\n    gl_FragColor = vec4(1.0, 1.0, 1.0, 0.2);\n    gl_FragDepthEXT = gl_FragCoord.z - 1e-6;\n}\n";
                    return _this;
                }
                CollisionProgram.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return CollisionProgram;
            }(Viewer.Program));
            WaterboxProgram = /** @class */ (function (_super) {
                __extends(WaterboxProgram, _super);
                function WaterboxProgram() {
                    var _this = _super !== null && _super.apply(this, arguments) || this;
                    _this.vert = "\nuniform mat4 u_modelView;\nuniform mat4 u_projection;\nattribute vec3 a_position;\n\nvoid main() {\n    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n}\n";
                    _this.frag = "\nvoid main() {\n    gl_FragColor = vec4(0.2, 0.6, 1.0, 0.2);\n}\n";
                    return _this;
                }
                WaterboxProgram.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return WaterboxProgram;
            }(Viewer.Program));
            Scene = /** @class */ (function () {
                function Scene(gl, zelview0) {
                    var _this = this;
                    this.cameraController = Viewer.FPSCameraController;
                    this.zelview0 = zelview0;
                    this.textures = [];
                    this.program_BG = new BillboardBGProgram();
                    this.program_COLL = new CollisionProgram();
                    this.program_DL = new F3DEX2Program();
                    this.program_WATERS = new WaterboxProgram();
                    var mainScene = zelview0.loadMainScene(gl);
                    mainScene.rooms.forEach(function (room) {
                        _this.textures = _this.textures.concat(room.mesh.textures);
                    });
                    var renderScene = this.translateScene(gl, mainScene);
                    var renderCollision = this.translateCollision(gl, mainScene);
                    var renderWaterBoxes = this.translateWaterBoxes(gl, mainScene);
                    this.render = function (state) {
                        renderScene(state);
                        renderCollision(state);
                        renderWaterBoxes(state);
                    };
                }
                Scene.prototype.translateScene = function (gl, scene) {
                    var _this = this;
                    return function (state) {
                        var gl = state.gl;
                        var renderDL = function (dl) {
                            dl.cmds.forEach(function (cmd) {
                                cmd(state);
                            });
                        };
                        var renderMesh = function (mesh) {
                            if (mesh.bg) {
                                state.useProgram(_this.program_BG);
                                mesh.bg(state);
                            }
                            state.useProgram(_this.program_DL);
                            mesh.opaque.forEach(renderDL);
                            mesh.transparent.forEach(renderDL);
                        };
                        var renderRoom = function (room) {
                            renderMesh(room.mesh);
                        };
                        state.useProgram(_this.program_DL);
                        scene.rooms.forEach(function (room) { return renderRoom(room); });
                    };
                };
                Scene.prototype.translateCollision = function (gl, scene) {
                    var _this = this;
                    var coll = scene.collision;
                    function stitchLines(ibd) {
                        var lines = new Uint16Array(ibd.length * 2);
                        var o = 0;
                        for (var i = 0; i < ibd.length; i += 3) {
                            lines[o++] = ibd[i + 0];
                            lines[o++] = ibd[i + 1];
                            lines[o++] = ibd[i + 1];
                            lines[o++] = ibd[i + 2];
                            lines[o++] = ibd[i + 2];
                            lines[o++] = ibd[i + 0];
                        }
                        return lines;
                    }
                    var collIdxBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
                    var lineData = stitchLines(coll.polys);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
                    var nLinePrim = lineData.length;
                    var collVertBuffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, coll.verts, gl.STATIC_DRAW);
                    return function (state) {
                        var prog = _this.program_COLL;
                        state.useProgram(prog);
                        gl.enable(gl.BLEND);
                        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                        gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
                        gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
                        gl.enableVertexAttribArray(prog.positionLocation);
                        gl.drawElements(gl.LINES, nLinePrim, gl.UNSIGNED_SHORT, 0);
                        gl.disableVertexAttribArray(prog.positionLocation);
                    };
                };
                Scene.prototype.translateWaterBoxes = function (gl, scene) {
                    var _this = this;
                    var coll = scene.collision;
                    var wbVtx = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
                    gl.bufferData(gl.ARRAY_BUFFER, coll.waters, gl.STATIC_DRAW);
                    var wbIdxData = new Uint16Array(coll.waters.length / 3);
                    for (var i = 0; i < wbIdxData.length; i++)
                        wbIdxData[i] = i;
                    var wbIdx = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
                    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wbIdxData, gl.STATIC_DRAW);
                    return function (state) {
                        var prog = _this.program_WATERS;
                        state.useProgram(prog);
                        gl.disable(gl.CULL_FACE);
                        gl.bindBuffer(gl.ARRAY_BUFFER, wbVtx);
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wbIdx);
                        gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
                        gl.enableVertexAttribArray(prog.positionLocation);
                        for (var i = 0; i < wbIdxData.length; i += 4)
                            gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, i * 2);
                        gl.disableVertexAttribArray(prog.positionLocation);
                        gl.disable(gl.BLEND);
                    };
                };
                return Scene;
            }());
            SceneDesc = /** @class */ (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                    this.id = this.path;
                }
                SceneDesc.prototype.createScene = function (gl) {
                    return util_12.fetch(this.path).then(function (result) {
                        var zelview0 = ZELVIEW0.readZELVIEW0(result);
                        return new Scene(gl, zelview0);
                    });
                };
                return SceneDesc;
            }());
            exports_25("SceneDesc", SceneDesc);
        }
    };
});
System.register("zelview/scenes", ["zelview/render"], function (exports_26, context_26) {
    "use strict";
    var __moduleName = context_26 && context_26.id;
    var render_5, id, name, sceneDescs, sceneGroup;
    return {
        setters: [
            function (render_5_1) {
                render_5 = render_5_1;
            }
        ],
        execute: function () {
            id = "zelview";
            name = "Ocarina of Time";
            sceneDescs = [
                {
                    filename: "ydan_scene",
                    label: "Inside the Deku Tree",
                },
                {
                    filename: "ddan_scene",
                    label: "Dodongo's Cavern",
                },
                {
                    filename: "bdan_scene",
                    label: "Inside Jabu-Jabu's Belly",
                },
                {
                    filename: "Bmori1_scene",
                    label: "Forest Temple",
                },
                {
                    filename: "HIDAN_scene",
                    label: "Fire Temple",
                },
                {
                    filename: "MIZUsin_scene",
                    label: "Water Temple",
                },
                {
                    filename: "jyasinzou_scene",
                    label: "Spirit Temple",
                },
                {
                    filename: "HAKAdan_scene",
                    label: "Shadow Temple",
                },
                {
                    filename: "HAKAdanCH_scene",
                    label: "Bottom of the Well",
                },
                {
                    filename: "ice_doukutu_scene",
                    label: "Ice Cavern",
                },
                {
                    filename: "ganon_scene",
                    label: "Ganon's Castle Tower",
                },
                {
                    filename: "men_scene",
                    label: "Gerudo Training Grounds",
                },
                {
                    filename: "gerudoway_scene",
                    label: "Thieves' Hideout",
                },
                {
                    filename: "ganontika_scene",
                    label: "Ganon's Castle",
                },
                {
                    filename: "ganon_sonogo_scene",
                    label: "Ganon's Castle Tower (Crumbling)",
                },
                {
                    filename: "ganontikasonogo_scene",
                    label: "Ganon's Castle (Crumbling)",
                },
                {
                    filename: "takaraya_scene",
                    label: "Treasure Chest Contest",
                },
                {
                    filename: "ydan_boss_scene",
                    label: "Inside the Deku Tree (Boss)",
                },
                {
                    filename: "ddan_boss_scene",
                    label: "Dodongo's Cavern (Boss)",
                },
                {
                    filename: "bdan_boss_scene",
                    label: "Inside Jabu-Jabu's Belly (Boss)",
                },
                {
                    filename: "moribossroom_scene",
                    label: "Forest Temple (Boss)",
                },
                {
                    filename: "FIRE_bs_scene",
                    label: "Fire Temple (Boss)",
                },
                {
                    filename: "MIZUsin_bs_scene",
                    label: "Water Temple (Boss)",
                },
                {
                    filename: "jyasinboss_scene",
                    label: "Spirit Temple (Mid-Boss)",
                },
                {
                    filename: "HAKAdan_bs_scene",
                    label: "Shadow Temple (Boss)",
                },
                {
                    filename: "ganon_boss_scene",
                    label: "Second-To-Last Boss Ganondorf",
                },
                {
                    filename: "ganon_final_scene",
                    label: "Ganondorf, Death Scene",
                },
                {
                    filename: "entra_scene",
                    label: "Market Entrance (Day)",
                },
                {
                    filename: "entra_n_scene",
                    label: "Market Entrance (Night)",
                },
                {
                    filename: "enrui_scene",
                    label: "Market Entrance (Adult)",
                },
                {
                    filename: "market_alley_scene",
                    label: "Back Alley (Day)",
                },
                {
                    filename: "market_alley_n_scene",
                    label: "Back Alley (Night)",
                },
                {
                    filename: "market_day_scene",
                    label: "Market (Day)",
                },
                {
                    filename: "market_night_scene",
                    label: "Market (Night)",
                },
                {
                    filename: "market_ruins_scene",
                    label: "Market (Adult)",
                },
                {
                    filename: "shrine_scene",
                    label: "Temple of Time (Outside, Day)",
                },
                {
                    filename: "shrine_n_scene",
                    label: "Temple of Time (Outside, Night)",
                },
                {
                    filename: "shrine_r_scene",
                    label: "Temple of Time (Outside, Adult)",
                },
                {
                    filename: "kokiri_home_scene",
                    label: "Know-it-all Brothers",
                },
                {
                    filename: "kokiri_home3_scene",
                    label: "House of Twins",
                },
                {
                    filename: "kokiri_home4_scene",
                    label: "Mido's House",
                },
                {
                    filename: "kokiri_home5_scene",
                    label: "Saria's House",
                },
                {
                    filename: "kakariko_scene",
                    label: "Kakariko Village House",
                },
                {
                    filename: "kakariko3_scene",
                    label: "Back Alley Village House",
                },
                {
                    filename: "shop1_scene",
                    label: "Kakariko Bazaar",
                },
                {
                    filename: "kokiri_shop_scene",
                    label: "Kokiri Shop",
                },
                {
                    filename: "golon_scene",
                    label: "Goron Shop",
                },
                {
                    filename: "zoora_scene",
                    label: "Zora Shop",
                },
                {
                    filename: "drag_scene",
                    label: "Kakariko Potion Shop",
                },
                {
                    filename: "alley_shop_scene",
                    label: "Market Potion Shop",
                },
                {
                    filename: "night_shop_scene",
                    label: "Bombchu Shop",
                },
                {
                    filename: "face_shop_scene",
                    label: "Happy Mask Shop",
                },
                {
                    filename: "link_home_scene",
                    label: "Link's House",
                },
                {
                    filename: "impa_scene",
                    label: "Puppy Woman's House",
                },
                {
                    filename: "malon_stable_scene",
                    label: "Stables",
                },
                {
                    filename: "labo_scene",
                    label: "Impa's House",
                },
                {
                    filename: "hylia_labo_scene",
                    label: "Lakeside Laboratory",
                },
                {
                    filename: "tent_scene",
                    label: "Carpenter's Tent",
                },
                {
                    filename: "hut_scene",
                    label: "Dampé's Hut",
                },
                {
                    filename: "daiyousei_izumi_scene",
                    label: "Great Fairy Fountain",
                },
                {
                    filename: "yousei_izumi_tate_scene",
                    label: "Small Fairy Fountain",
                },
                {
                    filename: "yousei_izumi_yoko_scene",
                    label: "Magic Fairy Fountain",
                },
                {
                    filename: "kakusiana_scene",
                    label: "Grottos",
                },
                {
                    filename: "hakaana_scene",
                    label: "Grave (1)",
                },
                {
                    filename: "hakaana2_scene",
                    label: "Grave (2)",
                },
                {
                    filename: "hakaana_ouke_scene",
                    label: "Royal Family's Tomb",
                },
                {
                    filename: "syatekijyou_scene",
                    label: "Shooting Gallery",
                },
                {
                    filename: "tokinoma_scene",
                    label: "Temple of Time Inside",
                },
                {
                    filename: "kenjyanoma_scene",
                    label: "Chamber of Sages",
                },
                {
                    filename: "hairal_niwa_scene",
                    label: "Castle Courtyard (Day)",
                },
                {
                    filename: "hairal_niwa_n_scene",
                    label: "Castle Courtyard (Night)",
                },
                {
                    filename: "hiral_demo_scene",
                    label: "Cutscene Map",
                },
                {
                    filename: "hakasitarelay_scene",
                    label: "Dampé's Grave & Kakariko Windmill",
                },
                {
                    filename: "turibori_scene",
                    label: "Fishing Pond",
                },
                {
                    filename: "nakaniwa_scene",
                    label: "Zelda's Courtyard",
                },
                {
                    filename: "bowling_scene",
                    label: "Bombchu Bowling Alley",
                },
                {
                    filename: "souko_scene",
                    label: "Talon's House",
                },
                {
                    filename: "miharigoya_scene",
                    label: "Lots'o Pots",
                },
                {
                    filename: "mahouya_scene",
                    label: "Granny's Potion Shop",
                },
                {
                    filename: "ganon_demo_scene",
                    label: "Final Battle against Ganon",
                },
                {
                    filename: "kinsuta_scene",
                    label: "Skulltula House",
                },
                {
                    filename: "spot00_scene",
                    label: "Hyrule Field",
                },
                {
                    filename: "spot01_scene",
                    label: "Kakariko Village",
                },
                {
                    filename: "spot02_scene",
                    label: "Kakariko Graveyard",
                },
                {
                    filename: "spot03_scene",
                    label: "Zora's River",
                },
                {
                    filename: "spot04_scene",
                    label: "Kokiri Forest",
                },
                {
                    filename: "spot05_scene",
                    label: "Sacred Forest Meadow",
                },
                {
                    filename: "spot06_scene",
                    label: "Lake Hylia",
                },
                {
                    filename: "spot07_scene",
                    label: "Zora's Domain",
                },
                {
                    filename: "spot08_scene",
                    label: "Zora's Fountain",
                },
                {
                    filename: "spot09_scene",
                    label: "Gerudo Valley",
                },
                {
                    filename: "spot10_scene",
                    label: "Lost Woods",
                },
                {
                    filename: "spot11_scene",
                    label: "Desert Colossus",
                },
                {
                    filename: "spot12_scene",
                    label: "Gerudo's Fortress",
                },
                {
                    filename: "spot13_scene",
                    label: "Haunted Wasteland",
                },
                {
                    filename: "spot15_scene",
                    label: "Hyrule Castle",
                },
                {
                    filename: "spot16_scene",
                    label: "Death Mountain",
                },
                {
                    filename: "spot17_scene",
                    label: "Death Mountain Crater",
                },
                {
                    filename: "spot18_scene",
                    label: "Goron City",
                },
                {
                    filename: "spot20_scene",
                    label: "Lon Lon Ranch",
                },
                {
                    filename: "ganon_tou_scene",
                    label: "Ganon's Tower (Outside)",
                },
                {
                    filename: "test01_scene",
                    label: "Collision Testing Area",
                },
                {
                    filename: "besitu_scene",
                    label: "Besitu / Treasure Chest Warp",
                },
                {
                    filename: "depth_test_scene",
                    label: "Depth Test",
                },
                {
                    filename: "syotes_scene",
                    label: "Stalfos Middle Room",
                },
                {
                    filename: "syotes2_scene",
                    label: "Stalfos Boss Room",
                },
                {
                    filename: "sutaru_scene",
                    label: "Dark Link Testing Area",
                },
                {
                    filename: "hairal_niwa2_scene",
                    label: "Beta Castle Courtyard",
                },
                {
                    filename: "sasatest_scene",
                    label: "Action Testing Room",
                },
                {
                    filename: "testroom_scene",
                    label: "Item Testing Room",
                },
            ].map(function (entry) {
                var path = "data/zelview/" + entry.filename + ".zelview0";
                return new render_5.SceneDesc(entry.label, path);
            });
            exports_26("sceneGroup", sceneGroup = { id: id, name: name, sceneDescs: sceneDescs });
        }
    };
});
System.register("main", ["viewer", "mdl0/scenes", "oot3d/scenes", "sm64ds/scenes", "zelview/scenes"], function (exports_27, context_27) {
    "use strict";
    var __moduleName = context_27 && context_27.id;
    var viewer_1, MDL0, OOT3D, SM64DS, ZELVIEW, Main;
    return {
        setters: [
            function (viewer_1_1) {
                viewer_1 = viewer_1_1;
            },
            function (MDL0_2) {
                MDL0 = MDL0_2;
            },
            function (OOT3D_1) {
                OOT3D = OOT3D_1;
            },
            function (SM64DS_1) {
                SM64DS = SM64DS_1;
            },
            function (ZELVIEW_1) {
                ZELVIEW = ZELVIEW_1;
            }
        ],
        execute: function () {
            Main = /** @class */ (function () {
                function Main() {
                    var _this = this;
                    this.canvas = document.createElement('canvas');
                    this.canvas.onmousedown = function () {
                        _this._deselectUI();
                    };
                    document.body.appendChild(this.canvas);
                    window.onresize = this._onResize.bind(this);
                    this._onResize();
                    window.addEventListener('keydown', this._onKeyDown.bind(this));
                    this.viewer = new viewer_1.Viewer(this.canvas);
                    this.viewer.start();
                    this.groups = [];
                    // The "plugin" part of this.
                    this.groups.push(MDL0.sceneGroup);
                    this.groups.push(SM64DS.sceneGroup);
                    this.groups.push(ZELVIEW.sceneGroup);
                    this.groups.push(OOT3D.sceneGroup);
                    // this.groups.push(J3D.sceneGroup);
                    this._makeUI();
                    // Load the state from the hash
                    this._loadState(window.location.hash.slice(1));
                    // If it didn't work, fall back to defaults.
                    if (!this.currentSceneDesc)
                        this._loadSceneGroup(this.groups[0]);
                }
                Main.prototype._onResize = function () {
                    this.canvas.width = window.innerWidth;
                    this.canvas.height = window.innerHeight;
                };
                Main.prototype._loadState = function (state) {
                    var _a = __read(state.split('/')), groupId = _a[0], sceneRest = _a.slice(1);
                    var sceneId = sceneRest.join('/');
                    var group = this.groups.find(function (g) { return g.id === groupId; });
                    if (!group)
                        return;
                    var desc = group.sceneDescs.find(function (d) { return d.id === sceneId; });
                    if (!desc)
                        return;
                    this._loadSceneGroup(group, false);
                    this._loadSceneDesc(desc);
                };
                Main.prototype._saveState = function () {
                    var groupId = this.currentSceneGroup.id;
                    var sceneId = this.currentSceneDesc.id;
                    return groupId + "/" + sceneId;
                };
                Main.prototype._loadSceneDesc = function (sceneDesc) {
                    var _this = this;
                    if (this.currentSceneDesc === sceneDesc)
                        return;
                    this.currentSceneDesc = sceneDesc;
                    // Make sure combobox is selected
                    for (var i = 0; i < this.sceneSelect.options.length; i++) {
                        var sceneOption = this.sceneSelect.options[i];
                        if (sceneOption.sceneDesc === sceneDesc)
                            this.sceneSelect.selectedIndex = i;
                    }
                    var gl = this.viewer.sceneGraph.renderState.viewport.gl;
                    sceneDesc.createScene(gl).then(function (result) {
                        _this.viewer.setScene(result);
                        // XXX: Provide a UI for textures eventually?
                        _this.texturesView.innerHTML = '';
                        result.textures.forEach(function (canvas) {
                            var tex = document.createElement('div');
                            tex.style.margin = '1em';
                            canvas.style.margin = '2px';
                            canvas.style.border = '1px dashed black';
                            tex.appendChild(canvas);
                            var label = document.createElement('span');
                            label.textContent = canvas.title;
                            tex.appendChild(label);
                            _this.texturesView.appendChild(tex);
                        });
                    });
                    this._deselectUI();
                    window.history.replaceState('', '', '#' + this._saveState());
                };
                Main.prototype._deselectUI = function () {
                    // Take focus off of the select.
                    this.groupSelect.blur();
                    this.sceneSelect.blur();
                    this.canvas.focus();
                };
                Main.prototype._onGearButtonClicked = function () {
                    this.gearSettings.style.display = this.gearSettings.style.display === 'block' ? 'none' : 'block';
                };
                Main.prototype._onGroupSelectChange = function () {
                    var option = this.groupSelect.selectedOptions.item(0);
                    var group = option.group;
                    this._loadSceneGroup(group);
                };
                Main.prototype._loadSceneGroup = function (group, loadDefaultSceneInGroup) {
                    if (loadDefaultSceneInGroup === void 0) { loadDefaultSceneInGroup = true; }
                    if (this.currentSceneGroup === group)
                        return;
                    this.currentSceneGroup = group;
                    // Make sure combobox is selected
                    for (var i = 0; i < this.groupSelect.options.length; i++) {
                        var groupOption = this.groupSelect.options[i];
                        if (groupOption.group === group)
                            this.groupSelect.selectedIndex = i;
                    }
                    // Clear.
                    this.sceneSelect.innerHTML = '';
                    try {
                        for (var _a = __values(group.sceneDescs), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var sceneDesc = _b.value;
                            var sceneOption = document.createElement('option');
                            sceneOption.textContent = sceneDesc.name;
                            sceneOption.sceneDesc = sceneDesc;
                            this.sceneSelect.appendChild(sceneOption);
                        }
                    }
                    catch (e_15_1) { e_15 = { error: e_15_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_15) throw e_15.error; }
                    }
                    if (loadDefaultSceneInGroup)
                        this._loadSceneDesc(group.sceneDescs[0]);
                    var e_15, _c;
                };
                Main.prototype._onSceneSelectChange = function () {
                    var option = this.sceneSelect.selectedOptions.item(0);
                    var sceneDesc = option.sceneDesc;
                    this._loadSceneDesc(sceneDesc);
                };
                Main.prototype._makeUI = function () {
                    this.uiContainers = document.createElement('div');
                    document.body.appendChild(this.uiContainers);
                    var uiContainerL = document.createElement('div');
                    uiContainerL.style.position = 'absolute';
                    uiContainerL.style.left = '2em';
                    uiContainerL.style.bottom = '2em';
                    this.uiContainers.appendChild(uiContainerL);
                    var uiContainerR = document.createElement('div');
                    uiContainerR.style.position = 'absolute';
                    uiContainerR.style.right = '2em';
                    uiContainerR.style.bottom = '2em';
                    this.uiContainers.appendChild(uiContainerR);
                    this.groupSelect = document.createElement('select');
                    try {
                        for (var _a = __values(this.groups), _b = _a.next(); !_b.done; _b = _a.next()) {
                            var group = _b.value;
                            var groupOption = document.createElement('option');
                            groupOption.textContent = group.name;
                            groupOption.group = group;
                            this.groupSelect.appendChild(groupOption);
                        }
                    }
                    catch (e_16_1) { e_16 = { error: e_16_1 }; }
                    finally {
                        try {
                            if (_b && !_b.done && (_c = _a.return)) _c.call(_a);
                        }
                        finally { if (e_16) throw e_16.error; }
                    }
                    this.groupSelect.onchange = this._onGroupSelectChange.bind(this);
                    this.groupSelect.style.marginRight = '1em';
                    uiContainerL.appendChild(this.groupSelect);
                    this.sceneSelect = document.createElement('select');
                    this.sceneSelect.onchange = this._onSceneSelectChange.bind(this);
                    this.sceneSelect.style.marginRight = '1em';
                    uiContainerL.appendChild(this.sceneSelect);
                    this.gearSettings = document.createElement('div');
                    this.gearSettings.style.backgroundColor = 'white';
                    this.gearSettings.style.position = 'absolute';
                    this.gearSettings.style.top = this.gearSettings.style.bottom =
                        this.gearSettings.style.left = this.gearSettings.style.right = '4em';
                    this.gearSettings.style.boxShadow = '0px 0px 10px rgba(0, 0, 0, 0.4)';
                    this.gearSettings.style.padding = '1em';
                    this.gearSettings.style.display = 'none';
                    this.gearSettings.style.overflow = 'auto';
                    document.body.appendChild(this.gearSettings);
                    var fovSlider = document.createElement('input');
                    fovSlider.type = 'range';
                    fovSlider.max = '100';
                    fovSlider.min = '1';
                    fovSlider.oninput = this._onFovSliderChange.bind(this);
                    var fovSliderLabel = document.createElement('label');
                    fovSliderLabel.textContent = "Field of View";
                    this.gearSettings.appendChild(fovSliderLabel);
                    this.gearSettings.appendChild(fovSlider);
                    var texturesHeader = document.createElement('h3');
                    texturesHeader.textContent = 'Textures';
                    this.gearSettings.appendChild(texturesHeader);
                    this.texturesView = document.createElement('div');
                    this.gearSettings.appendChild(this.texturesView);
                    var gearButton = document.createElement('button');
                    gearButton.textContent = '⚙';
                    gearButton.onclick = this._onGearButtonClicked.bind(this);
                    uiContainerR.appendChild(gearButton);
                    var e_16, _c;
                };
                Main.prototype._toggleUI = function () {
                    this.uiContainers.style.display = this.uiContainers.style.display === 'none' ? 'block' : 'none';
                };
                Main.prototype._onKeyDown = function (e) {
                    if (e.key === 'z') {
                        this._toggleUI();
                        event.preventDefault();
                    }
                };
                Main.prototype._getSliderT = function (slider) {
                    return (+slider.value - +slider.min) / (+slider.max - +slider.min);
                };
                Main.prototype._onFovSliderChange = function (e) {
                    var slider = e.target;
                    var value = this._getSliderT(slider);
                    this.viewer.sceneGraph.renderState.fov = value * (Math.PI * 0.995);
                };
                return Main;
            }());
            window.main = new Main();
        }
    };
});
// Nintendo Yaz0 format.
System.register("yaz0", ["util"], function (exports_28, context_28) {
    "use strict";
    var __moduleName = context_28 && context_28.id;
    function decompress(srcBuffer) {
        var srcView = new DataView(srcBuffer);
        util_13.assert(util_13.readString(srcBuffer, 0x00, 0x04) === 'Yaz0');
        var uncompressedSize = srcView.getUint32(0x04, true);
        var dstBuffer = new Uint8Array(uncompressedSize);
        var srcOffs = 0x08;
        var dstOffs = 0x00;
        while (true) {
            var commandByte = srcView.getUint8(srcOffs++);
            var i = 8;
            while (i--) {
                if (commandByte & (1 << i)) {
                    // Literal.
                    uncompressedSize--;
                    dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                }
                else {
                    var tmp = srcView.getUint16(srcOffs, false);
                    srcOffs += 2;
                    var windowOffset = (tmp & 0x0FFF) + 1;
                    var windowLength = (tmp >> 12) + 2;
                    if (windowLength === 2) {
                        windowLength += srcView.getUint8(srcOffs) + 0x10;
                        srcOffs += 1;
                    }
                    var copyOffs = dstOffs - windowOffset;
                    uncompressedSize -= windowLength;
                    while (windowLength--)
                        dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
                }
                if (uncompressedSize <= 0)
                    return dstBuffer.buffer;
            }
        }
    }
    exports_28("decompress", decompress);
    var util_13;
    return {
        setters: [
            function (util_13_1) {
                util_13 = util_13_1;
            }
        ],
        execute: function () {// Nintendo Yaz0 format.
        }
    };
});
//# sourceMappingURL=main.js.map