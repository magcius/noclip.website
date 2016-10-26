var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
// Nintendo DS LZ77 (LZ10) format.
System.register("lz77", [], function(exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    // Header (8 bytes):
    //   Magic: "LZ77\x10" (5 bytes)
    //   Uncompressed size (3 bytes, little endian)
    // Data:
    //   Flags (1 byte)
    //   For each bit in the flags byte, from MSB to LSB:
    //     If flag is 1:
    //       LZ77 (2 bytes, little endian):
    //         Length: bits 0-3
    //         Offset: bits 4-15
    //         Copy Length+3 bytes from Offset back in the output buffer.
    //     If flag is 0:
    //       Literal: copy one byte from src to dest.
    function assert(b) {
        if (!b)
            throw new Error("Assert fail");
    }
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
    function decompress(srcBuffer) {
        var srcView = new DataView(srcBuffer);
        assert(readString(srcBuffer, 0x00, 0x05) == 'LZ77\x10');
        var uncompressedSize = srcView.getUint32(0x04, true) >> 8;
        var dstBuffer = new Uint8Array(uncompressedSize);
        var srcOffs = 0x08;
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
    exports_1("decompress", decompress);
    return {
        setters:[],
        execute: function() {
        }
    }
});
/// <reference path="decl.d.ts" />
System.register("viewer", [], function(exports_2, context_2) {
    "use strict";
    var __moduleName = context_2 && context_2.id;
    var Viewport, Program, RenderState, SceneGraph, Viewer;
    function compileShader(gl, str, type) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, str);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }
    return {
        setters:[],
        execute: function() {
            Viewport = (function () {
                function Viewport() {
                }
                return Viewport;
            }());
            Program = (function () {
                function Program() {
                }
                Program.prototype.compile = function (gl) {
                    if (this._glProg)
                        return this._glProg;
                    var vertShader = compileShader(gl, this.vert, gl.VERTEX_SHADER);
                    var fragShader = compileShader(gl, this.frag, gl.FRAGMENT_SHADER);
                    var prog = gl.createProgram();
                    gl.attachShader(prog, vertShader);
                    gl.attachShader(prog, fragShader);
                    gl.linkProgram(prog);
                    this._glProg = prog;
                    this.bind(gl, prog);
                    return this._glProg;
                };
                Program.prototype.bind = function (gl, prog) {
                    this.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
                    this.projectionLocation = gl.getUniformLocation(prog, "u_projection");
                };
                return Program;
            }());
            exports_2("Program", Program);
            RenderState = (function () {
                function RenderState(viewport) {
                    this.currentProgram = null;
                    this.viewport = viewport;
                    this.projection = window.mat4.create();
                    window.mat4.perspective(this.projection, Math.PI / 4, viewport.canvas.width / viewport.canvas.height, 0.2, 50000);
                    this.modelView = window.mat4.create();
                }
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
            SceneGraph = (function () {
                function SceneGraph(viewport) {
                    this.scenes = [];
                    this.renderState = new RenderState(viewport);
                    var gl = this.renderState.viewport.gl;
                    gl.viewport(0, 0, viewport.canvas.width, viewport.canvas.height);
                    gl.clearColor(200 / 255, 50 / 255, 153 / 255, 1);
                }
                SceneGraph.prototype.render = function () {
                    var _this = this;
                    var gl = this.renderState.viewport.gl;
                    gl.depthMask(true);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    this.scenes.forEach(function (scene) { return scene.render(_this.renderState); });
                };
                SceneGraph.prototype.setScenes = function (scenes) {
                    this.scenes = scenes;
                    this.render();
                };
                SceneGraph.prototype.setCamera = function (matrix) {
                    window.mat4.invert(this.renderState.modelView, matrix);
                    this.render();
                };
                return SceneGraph;
            }());
            Viewer = (function () {
                function Viewer(canvas) {
                    var gl = canvas.getContext("webgl", { alpha: false });
                    var viewport = { canvas: canvas, gl: gl };
                    this.sceneGraph = new SceneGraph(viewport);
                    this.camera = window.mat4.create();
                }
                Viewer.prototype.resetCamera = function () {
                    window.mat4.identity(this.camera);
                };
                Viewer.prototype.setScene = function (scene) {
                    this.sceneGraph.setScenes([scene]);
                    this.resetCamera();
                };
                Viewer.prototype.start = function () {
                    var _this = this;
                    var camera = this.camera;
                    var canvas = this.sceneGraph.renderState.viewport.canvas;
                    var keysDown = {};
                    var SHIFT = 16;
                    function isKeyDown(key) {
                        return !!keysDown[key.charCodeAt(0)];
                    }
                    window.addEventListener('keydown', function (e) {
                        keysDown[e.keyCode] = true;
                    });
                    window.addEventListener('keyup', function (e) {
                        delete keysDown[e.keyCode];
                    });
                    function elemDragger(elem, callback) {
                        var lx, ly;
                        function mousemove(e) {
                            var dx = e.pageX - lx, dy = e.pageY - ly;
                            lx = e.pageX;
                            ly = e.pageY;
                            callback(dx, dy);
                        }
                        function mouseup(e) {
                            document.removeEventListener('mouseup', mouseup);
                            document.removeEventListener('mousemove', mousemove);
                            document.body.classList.remove('grabbing');
                        }
                        elem.addEventListener('mousedown', function (e) {
                            lx = e.pageX;
                            ly = e.pageY;
                            document.addEventListener('mouseup', mouseup);
                            document.addEventListener('mousemove', mousemove);
                            document.body.classList.add('grabbing');
                            e.preventDefault();
                        });
                    }
                    elemDragger(canvas, function (dx, dy) {
                        var cu = [camera[1], camera[5], camera[9]];
                        window.vec3.normalize(cu, cu);
                        window.mat4.rotate(camera, camera, -dx / 500, cu);
                        window.mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
                    });
                    var tmp = window.mat4.create();
                    var t = 0;
                    var update = function (nt) {
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
                        _this.sceneGraph.setCamera(camera);
                        window.requestAnimationFrame(update);
                    };
                    update(0);
                };
                return Viewer;
            }());
            exports_2("Viewer", Viewer);
        }
    }
});
// Read DS Geometry Engine commands.
System.register("sm64ds/nitro_gx", [], function(exports_3, context_3) {
    "use strict";
    var __moduleName = context_3 && context_3.id;
    var CmdType, PolyType, VERTEX_SIZE, VERTEX_BYTES, Packet, Color, TexCoord, Point, Vertex, Context, ContextInternal;
    function rgb5(pixel) {
        var r, g, b;
        r = (pixel & 0x7c00) >> 10;
        r = (r << (8 - 5)) | (r >> (10 - 8));
        g = (pixel & 0x3e0) >> 5;
        g = (g << (8 - 5)) | (g >> (10 - 8));
        b = pixel & 0x1f;
        b = (b << (8 - 5)) | (b >> (10 - 8));
        return { r: r, g: g, b: b };
    }
    exports_3("rgb5", rgb5);
    function cmd_MTX_RESTORE(ctx) {
        // XXX: We don't implement the matrix stack yet.
        ctx.readParam();
    }
    function cmd_COLOR(ctx) {
        var param = ctx.readParam();
        ctx.s_color = rgb5(param);
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
            vtxArray[3] = v.color.b / 0xFF;
            vtxArray[4] = v.color.g / 0xFF;
            vtxArray[5] = v.color.r / 0xFF;
            vtxArray[6] = ctx.alpha / 0xFF;
            vtxArray[7] = v.uv.s;
            vtxArray[8] = v.uv.t;
        }
        var idxBuffer;
        if (ctx.s_polyType === PolyType.TRIANGLES) {
            idxBuffer = new Uint16Array(nVerts);
            for (var i_1 = 0; i_1 < nVerts; i_1++)
                idxBuffer[i_1] = i_1;
        }
        else if (ctx.s_polyType === PolyType.QUADS) {
            idxBuffer = new Uint16Array(nVerts / 4 * 6);
            var dst = 0;
            for (var i_2 = 0; i_2 < nVerts; i_2 += 4) {
                idxBuffer[dst++] = i_2 + 0;
                idxBuffer[dst++] = i_2 + 1;
                idxBuffer[dst++] = i_2 + 2;
                idxBuffer[dst++] = i_2 + 2;
                idxBuffer[dst++] = i_2 + 3;
                idxBuffer[dst++] = i_2 + 0;
            }
        }
        else if (ctx.s_polyType === PolyType.TRIANGLE_STRIP) {
            idxBuffer = new Uint16Array((nVerts - 2) * 3);
            var dst = 0;
            for (var i_3 = 0; i_3 < nVerts - 2; i_3++) {
                if (i_3 % 2 === 0) {
                    idxBuffer[dst++] = i_3 + 0;
                    idxBuffer[dst++] = i_3 + 1;
                    idxBuffer[dst++] = i_3 + 2;
                }
                else {
                    idxBuffer[dst++] = i_3 + 1;
                    idxBuffer[dst++] = i_3 + 0;
                    idxBuffer[dst++] = i_3 + 2;
                }
            }
        }
        else if (ctx.s_polyType === PolyType.QUAD_STRIP) {
            idxBuffer = new Uint16Array(((nVerts - 2) / 2) * 6);
            var dst = 0;
            for (var i_4 = 0; i_4 < nVerts; i_4 += 2) {
                idxBuffer[dst++] = i_4 + 0;
                idxBuffer[dst++] = i_4 + 1;
                idxBuffer[dst++] = i_4 + 3;
                idxBuffer[dst++] = i_4 + 3;
                idxBuffer[dst++] = i_4 + 2;
                idxBuffer[dst++] = i_4 + 0;
            }
        }
        var packet = new Packet();
        packet.vertData = vtxBuffer;
        packet.idxData = idxBuffer;
        packet.polyType = ctx.s_polyType;
        ctx.packets.push(packet);
        ctx.vtxs = null;
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
    exports_3("readCmds", readCmds);
    return {
        setters:[],
        execute: function() {
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
            Packet = (function () {
                function Packet() {
                }
                return Packet;
            }());
            exports_3("Packet", Packet);
            ;
            Color = (function () {
                function Color() {
                }
                return Color;
            }());
            ;
            TexCoord = (function () {
                function TexCoord() {
                }
                return TexCoord;
            }());
            ;
            Point = (function () {
                function Point() {
                }
                return Point;
            }());
            ;
            Vertex = (function () {
                function Vertex() {
                }
                return Vertex;
            }());
            ;
            Context = (function () {
                function Context() {
                }
                return Context;
            }());
            exports_3("Context", Context);
            ;
            ContextInternal = (function () {
                function ContextInternal(buffer, baseCtx) {
                    this.offs = 0;
                    this.s_texCoord = new TexCoord();
                    this.alpha = baseCtx.alpha;
                    this.s_color = baseCtx.color;
                    this.view = new DataView(buffer);
                    this.s_texCoord = new TexCoord();
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
            ;
        }
    }
});
// Read DS texture formats.
System.register("sm64ds/nitro_tex", [], function(exports_4, context_4) {
    "use strict";
    var __moduleName = context_4 && context_4.id;
    var Format;
    function color(a, r, g, b) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }
    function rgb5(pixel, alpha) {
        var r, g, b;
        r = (pixel & 0x7c00) >>> 10;
        r = (r << (8 - 5)) | (r >>> (10 - 8));
        g = (pixel & 0x3e0) >>> 5;
        g = (g << (8 - 5)) | (g >>> (10 - 8));
        b = pixel & 0x1f;
        b = (b << (8 - 5)) | (b >>> (10 - 8));
        return color(alpha, r, g, b);
    }
    function writeColor(pixels, dstPixel, pixel) {
        var dstOffs = dstPixel * 4;
        var a = ((pixel >>> 24) & 0xFF);
        var r = ((pixel >>> 16) & 0xFF);
        var g = ((pixel >>> 8) & 0xFF);
        var b = ((pixel >>> 0) & 0xFF);
        pixels[dstOffs++] = b;
        pixels[dstOffs++] = g;
        pixels[dstOffs++] = r;
        pixels[dstOffs++] = a;
    }
    function readTexture_A3I5(width, height, texData, palData) {
        var pixels = new Uint8Array(width * height * 4);
        var texView = new DataView(texData);
        var palView = new DataView(palData);
        var srcOffs = 0;
        for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
                var texBlock = texView.getUint8(srcOffs++);
                var palIdx = (texBlock & 0x1F) << 1;
                var color = rgb5(palView.getUint16(palIdx, true), 0);
                var alpha = texBlock >>> 5;
                alpha = (alpha << (8 - 3)) | (alpha >>> (6 - 8));
                var pixel = alpha << 24 | color;
                var dstPixel = (y * width) + x;
                writeColor(pixels, dstPixel, pixel);
                texBlock >>= 2;
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
                    var pixel = rgb5(palView.getUint16(palIdx, true), color0 ? 0x00 : 0xFF);
                    var dstPixel = (y * width) + xx + x;
                    writeColor(pixels, dstPixel, pixel);
                    texBlock >>= 4;
                }
            }
        }
        return pixels;
    }
    function readTexture_CMPR_4x4(width, height, texData, palData) {
        function mix(p1, p2) {
            var a = (((p1 >>> 24) & 0xFF) + ((p2 >>> 24) & 0xFF)) >>> 1;
            var r = (((p1 >>> 16) & 0xFF) + ((p2 >>> 16) & 0xFF)) >>> 1;
            var g = (((p1 >>> 8) & 0xFF) + ((p2 >>> 8) & 0xFF)) >>> 1;
            var b = (((p1 >>> 0) & 0xFF) + ((p2 >>> 0) & 0xFF)) >>> 1;
            return color(a, r, g, b);
        }
        function mixs3(p1, p2) {
            // p1*(5/8) + p2*(3/8)
            var a1 = ((p1 >>> 24) & 0xFF);
            var r1 = ((p1 >>> 16) & 0xFF);
            var g1 = ((p1 >>> 8) & 0xFF);
            var b1 = ((p1 >>> 0) & 0xFF);
            var a2 = ((p2 >>> 24) & 0xFF);
            var r2 = ((p2 >>> 16) & 0xFF);
            var g2 = ((p2 >>> 8) & 0xFF);
            var b2 = ((p2 >>> 0) & 0xFF);
            var a = ((a1 >>> 1) + (a1 >>> 4)) + ((a2 >>> 1) - (a2 >>> 4));
            var r = ((r1 >>> 1) + (r1 >>> 4)) + ((r2 >>> 1) - (r2 >>> 4));
            var g = ((g1 >>> 1) + (g1 >>> 4)) + ((g2 >>> 1) - (g2 >>> 4));
            var b = ((b1 >>> 1) + (b1 >>> 4)) + ((b2 >>> 1) - (b2 >>> 4));
            return color(a, r, g, b);
        }
        function buildPalette(palBlock) {
            function getPal(offs) {
                if (offs >= palView.byteLength)
                    return 0xFF000000;
                return rgb5(palView.getUint16(offs, true), 0xFF);
            }
            var palMode = palBlock >> 14;
            var palOffs = (palBlock & 0x3FFF) << 2;
            var palette = new Uint32Array(4);
            palette[0] = getPal(palOffs + 0x00);
            palette[1] = getPal(palOffs + 0x02);
            if (palMode === 0) {
                // PTY=0, A=0
                palette[2] = getPal(palOffs + 0x04);
                palette[3] = 0x00000000;
            }
            else if (palMode === 1) {
                // PTY=1, A=0
                // Color2 is a blend of Color1/Color2.
                palette[2] = mix(palette[0], palette[1]);
                palette[3] = 0x00000000;
            }
            else if (palMode === 2) {
                // PTY=0, A=1
                palette[2] = getPal(palOffs + 0x04);
                palette[3] = getPal(palOffs + 0x06);
            }
            else {
                palette[2] = mixs3(palette[0], palette[1]);
                palette[3] = mixs3(palette[1], palette[0]);
            }
            return palette;
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
                var palette = buildPalette(palBlock);
                for (var y = 0; y < 4; y++) {
                    for (var x = 0; x < 4; x++) {
                        var palIdx = texBlock & 0x03;
                        var pixel = palette[palIdx];
                        var dstPixel = ((yy + y) * width) + xx + x;
                        writeColor(pixels, dstPixel, pixel);
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
                var palIdx = (texBlock & 0x3) << 1;
                var color = rgb5(palView.getUint16(palIdx, true), 0);
                var alpha = texBlock >>> 3;
                alpha = (alpha << (8 - 5)) | (alpha >>> (10 - 8));
                var pixel = alpha << 24 | color;
                var dstPixel = (y * width) + x;
                writeColor(pixels, dstPixel, pixel);
                texBlock >>= 2;
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
                var pixel = rgb5(texView.getUint16(srcOffs, true), 0xFF);
                srcOffs += 2;
                var dstPixel = (y * width) + x;
                writeColor(pixels, dstPixel, pixel);
            }
        }
        return pixels;
    }
    function readTexture(format, width, height, texData, palData, color0) {
        switch (format) {
            case Format.Tex_A3I5: return readTexture_A3I5(width, height, texData, palData);
            case Format.Tex_Palette16: return readTexture_Palette16(width, height, texData, palData, color0);
            case Format.Tex_CMPR_4x4: return readTexture_CMPR_4x4(width, height, texData, palData);
            case Format.Tex_A5I3: return readTexture_A5I3(width, height, texData, palData);
            case Format.Tex_Direct: return readTexture_Direct(width, height, texData);
            default: return console.warn("Unsupported texture format", format), null;
        }
    }
    exports_4("readTexture", readTexture);
    return {
        setters:[],
        execute: function() {
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
            exports_4("Format", Format);
            ;
        }
    }
});
/// <reference path="../decl.d.ts" />
System.register("sm64ds/nitro_bmd", ["sm64ds/nitro_gx", "sm64ds/nitro_tex"], function(exports_5, context_5) {
    "use strict";
    var __moduleName = context_5 && context_5.id;
    var NITRO_GX, NITRO_Tex;
    var Poly, Batch, Model, Texture, BMD;
    // Super Mario 64 DS .bmd format
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
    function parseModel(bmd, view, idx) {
        var offs = bmd.modelOffsBase + idx * 0x40;
        var model = new Model();
        model.id = view.getUint32(offs + 0x00, true);
        model.name = readString(view.buffer, view.getUint32(offs + 0x04, true), 0xFF);
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
        var poly = { packets: NITRO_GX.readCmds(gxCmdBuf, baseCtx) };
        return poly;
    }
    function parseMaterial(bmd, view, idx) {
        var offs = bmd.materialOffsBase + idx * 0x30;
        var material = {};
        material.name = readString(view.buffer, view.getUint32(offs + 0x00, true), 0xFF);
        material.texCoordMat = window.mat4.create();
        var textureIdx = view.getUint32(offs + 0x04, true);
        if (textureIdx !== 0xFFFFFFFF) {
            var paletteIdx = view.getUint32(offs + 0x08, true);
            material.texture = parseTexture(bmd, view, textureIdx, paletteIdx);
            material.texParams = material.texture.params | view.getUint32(offs + 0x20, true);
            if (material.texParams >> 30) {
                var scaleS = view.getInt32(offs + 0x0C, true) / 4096.0;
                var scaleT = view.getInt32(offs + 0x10, true) / 4096.0;
                var transS = view.getInt32(offs + 0x18, true) / 4096.0;
                var transT = view.getInt32(offs + 0x1C, true) / 4096.0;
                window.mat4.translate(material.texCoordMat, material.texCoordMat, [transS, transT, 0.0]);
                window.mat4.scale(material.texCoordMat, material.texCoordMat, [scaleS, scaleT, 1.0]);
            }
            window.mat4.scale(material.texCoordMat, material.texCoordMat, [1 / material.texture.width, 1 / material.texture.height, 1]);
        }
        else {
            material.texture = null;
            material.texParams = 0;
        }
        var polyAttribs = view.getUint32(offs + 0x24, true);
        var alpha = (polyAttribs >> 16) & 0x1F;
        alpha = (alpha << (8 - 5)) | (alpha >>> (10 - 8));
        // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
        // A transparent polygon is one that has an alpha of < 0xFF, or uses
        // A5I3 / A3I5 textures.
        material.isTranslucent = (alpha < 0xFF) || (material.texture && material.texture.isTranslucent);
        // Do transparent polys write to the depth buffer?
        var xl = (polyAttribs >>> 1) & 0x01;
        if (xl)
            material.depthWrite = true;
        else
            material.depthWrite = !material.isTranslucent;
        var difAmb = view.getUint32(offs + 0x28, true);
        if (difAmb & 0x8000)
            material.diffuse = NITRO_GX.rgb5(difAmb & 0x07FF);
        else
            material.diffuse = [0xFF, 0xFF, 0xFF];
        material.alpha = alpha;
        return material;
    }
    function parseTexture(bmd, view, texIdx, palIdx) {
        var texOffs = bmd.textureOffsBase + texIdx * 0x14;
        var texture = new Texture();
        texture.id = texIdx;
        texture.name = readString(view.buffer, view.getUint32(texOffs + 0x00, true), 0xFF);
        var texDataOffs = view.getUint32(texOffs + 0x04, true);
        var texDataSize = view.getUint32(texOffs + 0x08, true);
        var texData = view.buffer.slice(texDataOffs);
        texture.params = view.getUint32(texOffs + 0x10, true);
        texture.format = (texture.params >> 26) & 0x07;
        texture.width = 8 << ((texture.params >> 20) & 0x07);
        texture.height = 8 << ((texture.params >> 23) & 0x07);
        var color0 = !!((texture.params >> 29) & 0x01);
        var palData = null;
        if (palIdx != 0xFFFFFFFF) {
            var palOffs = bmd.paletteOffsBase + palIdx * 0x10;
            texture.paletteName = readString(view.buffer, view.getUint32(palOffs + 0x00, true), 0xFF);
            var palDataOffs = view.getUint32(palOffs + 0x04, true);
            var palDataSize = view.getUint32(palOffs + 0x08, true);
            palData = view.buffer.slice(palDataOffs, palDataOffs + palDataSize);
        }
        texture.pixels = NITRO_Tex.readTexture(texture.format, texture.width, texture.height, texData, palData, color0);
        texture.isTranslucent = (texture.format === NITRO_Tex.Format.Tex_A5I3 ||
            texture.format === NITRO_Tex.Format.Tex_A3I5);
        bmd.textures.push(texture);
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
        bmd.textures = [];
        bmd.models = [];
        for (var i = 0; i < bmd.modelCount; i++)
            bmd.models.push(parseModel(bmd, view, i));
        return bmd;
    }
    exports_5("parse", parse);
    return {
        setters:[
            function (NITRO_GX_1) {
                NITRO_GX = NITRO_GX_1;
            },
            function (NITRO_Tex_1) {
                NITRO_Tex = NITRO_Tex_1;
            }],
        execute: function() {
            Poly = (function () {
                function Poly() {
                }
                return Poly;
            }());
            exports_5("Poly", Poly);
            Batch = (function () {
                function Batch() {
                }
                return Batch;
            }());
            exports_5("Batch", Batch);
            ;
            Model = (function () {
                function Model() {
                }
                return Model;
            }());
            exports_5("Model", Model);
            ;
            Texture = (function () {
                function Texture() {
                }
                return Texture;
            }());
            exports_5("Texture", Texture);
            BMD = (function () {
                function BMD() {
                }
                return BMD;
            }());
            exports_5("BMD", BMD);
            ;
        }
    }
});
/// <reference path="../decl.d.ts" />
System.register("sm64ds/render", ["lz77", "viewer", "sm64ds/nitro_bmd"], function(exports_6, context_6) {
    "use strict";
    var __moduleName = context_6 && context_6.id;
    var LZ77, Viewer, NITRO_BMD;
    var DL_VERT_SHADER_SOURCE, DL_FRAG_SHADER_SOURCE, NITRO_Program, VERTEX_SIZE, VERTEX_BYTES, RenderPass, Texture, Scene, SceneDesc;
    function fetch(path) {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = "arraybuffer";
        request.send();
        return new window.Promise(function (resolve, reject) {
            request.onload = function () {
                resolve(request.response);
            };
            request.onerror = function () {
                reject();
            };
        });
    }
    return {
        setters:[
            function (LZ77_1) {
                LZ77 = LZ77_1;
            },
            function (Viewer_1) {
                Viewer = Viewer_1;
            },
            function (NITRO_BMD_1) {
                NITRO_BMD = NITRO_BMD_1;
            }],
        execute: function() {
            DL_VERT_SHADER_SOURCE = "\n    precision mediump float;\n    uniform mat4 u_modelView;\n    uniform mat4 u_localMatrix;\n    uniform mat4 u_projection;\n    uniform mat4 u_texCoordMat;\n    attribute vec3 a_position;\n    attribute vec2 a_uv;\n    attribute vec4 a_color;\n    varying vec4 v_color;\n    varying vec2 v_uv;\n    \n    void main() {\n        gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);\n        v_color = a_color;\n        v_uv = (u_texCoordMat * vec4(a_uv, 1.0, 1.0)).st;\n    }\n";
            DL_FRAG_SHADER_SOURCE = "\n    precision mediump float;\n    varying vec2 v_uv;\n    varying vec4 v_color;\n    uniform sampler2D u_texture;\n    \n    void main() {\n        gl_FragColor = texture2D(u_texture, v_uv);\n        gl_FragColor *= v_color;\n        if (gl_FragColor.a == 0.0)\n            discard;\n    }\n";
            NITRO_Program = (function (_super) {
                __extends(NITRO_Program, _super);
                function NITRO_Program() {
                    _super.apply(this, arguments);
                    this.vert = DL_VERT_SHADER_SOURCE;
                    this.frag = DL_FRAG_SHADER_SOURCE;
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
            ;
            Texture = (function () {
                function Texture(bmdTex) {
                    this.bmdTex = bmdTex;
                    this.title = bmdTex.name;
                }
                Texture.prototype.toCanvas = function () {
                    var canvas = document.createElement("canvas");
                    canvas.width = this.bmdTex.width;
                    canvas.height = this.bmdTex.height;
                    var ctx = canvas.getContext("2d");
                    var imgData = ctx.createImageData(canvas.width, canvas.height);
                    for (var i = 0; i < imgData.data.length; i++)
                        imgData.data[i] = this.bmdTex.pixels[i];
                    ctx.putImageData(imgData, 0, 0);
                    return canvas;
                };
                return Texture;
            }());
            Scene = (function () {
                function Scene(gl, bmd) {
                    var _this = this;
                    this.program = new NITRO_Program();
                    this.bmd = bmd;
                    this.textures = bmd.textures.map(function (texture) {
                        return new Texture(texture);
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
                    return function () {
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
                    return function () {
                        if (texture !== null) {
                            gl.uniformMatrix4fv(_this.program.texCoordMatLocation, false, material.texCoordMat);
                            gl.bindTexture(gl.TEXTURE_2D, texId);
                        }
                        gl.depthMask(material.depthWrite);
                    };
                };
                Scene.prototype.translateBatch = function (gl, batch) {
                    var batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;
                    var applyMaterial = this.translateMaterial(gl, batch.material);
                    var renderPoly = this.translatePoly(gl, batch.poly);
                    return function (pass) {
                        if (pass != batchPass)
                            return;
                        applyMaterial();
                        renderPoly();
                    };
                };
                Scene.prototype.translateModel = function (gl, bmdm) {
                    var _this = this;
                    var localMatrix = window.mat4.create();
                    var bmd = this.bmd;
                    window.mat4.scale(localMatrix, localMatrix, [bmd.scaleFactor, bmd.scaleFactor, bmd.scaleFactor]);
                    var batches = bmdm.batches.map(function (batch) { return _this.translateBatch(gl, batch); });
                    return function (pass) {
                        gl.uniformMatrix4fv(_this.program.localMatrixLocation, false, localMatrix);
                        batches.forEach(function (f) { f(pass); });
                    };
                };
                Scene.prototype.renderModels = function (pass) {
                    return this.modelFuncs.forEach(function (func) {
                        func(pass);
                    });
                };
                Scene.prototype.render = function (state) {
                    var gl = state.viewport.gl;
                    state.useProgram(this.program);
                    gl.enable(gl.DEPTH_TEST);
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    // First pass, opaque.
                    this.renderModels(RenderPass.OPAQUE);
                    // Second pass, translucent.
                    this.renderModels(RenderPass.TRANSLUCENT);
                };
                return Scene;
            }());
            SceneDesc = (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                }
                SceneDesc.prototype.createScene = function (gl) {
                    return fetch(this.path).then(function (result) {
                        var decompressed = LZ77.decompress(result);
                        var bmd = NITRO_BMD.parse(decompressed);
                        return new Scene(gl, bmd);
                    });
                };
                return SceneDesc;
            }());
            exports_6("SceneDesc", SceneDesc);
        }
    }
});
System.register("sm64ds/scenes", ["sm64ds/render"], function(exports_7, context_7) {
    "use strict";
    var __moduleName = context_7 && context_7.id;
    var render_1;
    var name, sceneDescs, sceneGroup;
    return {
        setters:[
            function (render_1_1) {
                render_1 = render_1_1;
            }],
        execute: function() {
            name = "Super Mario 64 DS";
            sceneDescs = [
                'battan_king_map_all.bmd',
                'bombhei_map_all.bmd',
                'castle_1f_all.bmd',
                'castle_2f_all.bmd',
                'castle_b1_all.bmd',
                'cave_all.bmd',
                'clock_tower_all.bmd',
                'desert_land_all.bmd',
                'desert_py_all.bmd',
                'ex_l_map_all.bmd',
                'ex_luigi_all.bmd',
                'ex_m_map_all.bmd',
                'ex_mario_all.bmd',
                'ex_w_map_all.bmd',
                'ex_wario_all.bmd',
                'fire_land_all.bmd',
                'fire_mt_all.bmd',
                'habatake_all.bmd',
                'high_mt_all.bmd',
                'high_slider_all.bmd',
                'horisoko_all.bmd',
                'kaizoku_irie_all.bmd',
                'kaizoku_ship_all.bmd',
                'koopa1_boss_all.bmd',
                'koopa1_map_all.bmd',
                'koopa2_boss_all.bmd',
                'koopa2_map_all.bmd',
                'koopa3_boss_all.bmd',
                'koopa3_map_all.bmd',
                'main_castle_all.bmd',
                'main_garden_all.bmd',
                'metal_switch_all.bmd',
                'playroom_all.bmd',
                'rainbow_cruise_all.bmd',
                'rainbow_mario_all.bmd',
                'snow_kama_all.bmd',
                'snow_land_all.bmd',
                'snow_mt_all.bmd',
                'snow_slider_all.bmd',
                'suisou_all.bmd',
                'teresa_house_all.bmd',
                'test_map_all.bmd',
                'test_map_b_all.bmd',
                'tibi_deka_d_all.bmd',
                'tibi_deka_in_all.bmd',
                'tibi_deka_t_all.bmd',
                'water_city_all.bmd',
                'water_land_all.bmd',
            ].map(function (filename) {
                var path = 'data/sm64ds/' + filename;
                return new render_1.SceneDesc(filename, path);
            });
            exports_7("sceneGroup", sceneGroup = { name: name, sceneDescs: sceneDescs });
        }
    }
});
System.register("main", ["viewer", "sm64ds/scenes"], function(exports_8, context_8) {
    "use strict";
    var __moduleName = context_8 && context_8.id;
    var viewer_1, SM64DS;
    var Main;
    return {
        setters:[
            function (viewer_1_1) {
                viewer_1 = viewer_1_1;
            },
            function (SM64DS_1) {
                SM64DS = SM64DS_1;
            }],
        execute: function() {
            Main = (function () {
                function Main() {
                    var canvas = document.querySelector('canvas');
                    this.viewer = new viewer_1.Viewer(canvas);
                    this.viewer.start();
                    this.groups = [];
                    // The "plugin" part of this.
                    this.groups.push(SM64DS.sceneGroup);
                    this.makeUI();
                }
                Main.prototype.loadSceneDesc = function (sceneDesc) {
                    var _this = this;
                    var gl = this.viewer.sceneGraph.renderState.viewport.gl;
                    sceneDesc.createScene(gl).then(function (result) {
                        _this.viewer.setScene(result);
                        var textures = document.querySelector('#textures');
                        textures.innerHTML = '';
                        result.textures.forEach(function (tex) {
                            var canvas = tex.toCanvas();
                            canvas.title = tex.title;
                            textures.appendChild(canvas);
                        });
                    });
                };
                Main.prototype.makeUI = function () {
                    var _this = this;
                    var pl = document.querySelector('#pl');
                    var select = document.createElement('select');
                    this.groups.forEach(function (group) {
                        var optgroup = document.createElement('optgroup');
                        optgroup.label = group.name;
                        select.appendChild(optgroup);
                        group.sceneDescs.forEach(function (sceneDesc) {
                            var option = document.createElement('option');
                            option.textContent = sceneDesc.name;
                            option.sceneDesc = sceneDesc;
                            optgroup.appendChild(option);
                        });
                    });
                    pl.appendChild(select);
                    var button = document.createElement('button');
                    button.textContent = 'Load';
                    button.addEventListener('click', function () {
                        var option = select.options[select.selectedIndex];
                        var sceneDesc = option.sceneDesc;
                        _this.loadSceneDesc(sceneDesc);
                    });
                    pl.appendChild(button);
                };
                return Main;
            }());
            exports_8("Main", Main);
            window.addEventListener('load', function () {
                window.main = new Main();
            });
        }
    }
});
//# sourceMappingURL=main.js.map