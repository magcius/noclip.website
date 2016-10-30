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
            throw new Error();
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
                    this.gl = this.viewport.gl;
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
                    // Enable EXT_frag_depth
                    gl.getExtension('EXT_frag_depth');
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
System.register("util", [], function(exports_6, context_6) {
    "use strict";
    var __moduleName = context_6 && context_6.id;
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
    exports_6("fetch", fetch);
    return {
        setters:[],
        execute: function() {
        }
    }
});
/// <reference path="../decl.d.ts" />
System.register("sm64ds/render", ["lz77", "viewer", "sm64ds/nitro_bmd", "util"], function(exports_7, context_7) {
    "use strict";
    var __moduleName = context_7 && context_7.id;
    var LZ77, Viewer, NITRO_BMD, util_1;
    var DL_VERT_SHADER_SOURCE, DL_FRAG_SHADER_SOURCE, NITRO_Program, VERTEX_SIZE, VERTEX_BYTES, RenderPass, Scene, SceneDesc;
    function textureToCanvas(bmdTex) {
        var canvas = document.createElement("canvas");
        canvas.width = bmdTex.width;
        canvas.height = bmdTex.height;
        canvas.title = bmdTex.name;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);
        for (var i = 0; i < imgData.data.length; i++)
            imgData.data[i] = bmdTex.pixels[i];
        ctx.putImageData(imgData, 0, 0);
        return canvas;
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
            },
            function (util_1_1) {
                util_1 = util_1_1;
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
            Scene = (function () {
                function Scene(gl, bmd) {
                    var _this = this;
                    this.program = new NITRO_Program();
                    this.bmd = bmd;
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
                    // Local fudge factor so that all the models in the viewer "line up".
                    var localScaleFactor = 100;
                    var scaleFactor = bmd.scaleFactor * localScaleFactor;
                    window.mat4.scale(localMatrix, localMatrix, [scaleFactor, scaleFactor, scaleFactor]);
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
                    return util_1.fetch(this.path).then(function (result) {
                        var decompressed = LZ77.decompress(result);
                        var bmd = NITRO_BMD.parse(decompressed);
                        return new Scene(gl, bmd);
                    });
                };
                return SceneDesc;
            }());
            exports_7("SceneDesc", SceneDesc);
        }
    }
});
System.register("sm64ds/scenes", ["sm64ds/render"], function(exports_8, context_8) {
    "use strict";
    var __moduleName = context_8 && context_8.id;
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
                { name: "Princess Peach's Castle - Gardens", filename: 'main_castle_all.bmd' },
                { name: "Princess Peach's Castle - 1st Floor", filename: 'castle_1f_all.bmd' },
                { name: "Princess Peach's Castle - 2nd Floor", filename: 'castle_2f_all.bmd' },
                { name: "Princess Peach's Castle - Basement", filename: 'castle_b1_all.bmd' },
                { name: "Princess Peach's Castle - Courtyard", filename: 'main_garden_all.bmd' },
                { name: "Bob-omb Battlefield", filename: 'bombhei_map_all.bmd' },
                { name: "Whomp's Fortress", filename: 'battan_king_map_all.bmd' },
                { name: "Jolly Roger Bay", filename: 'kaizoku_irie_all.bmd' },
                { name: "Jolly Roger Bay - Inside the Ship", filename: 'kaizoku_ship_all.bmd' },
                { name: "Cool, Cool Mountain", filename: 'snow_mt_all.bmd' },
                { name: "Cool, Cool Mountain - Inside the Slide", filename: 'snow_slider_all.bmd' },
                { name: "Big Boo's Haunt", filename: 'teresa_house_all.bmd' },
                { name: "Hazy Maze Cave", filename: 'cave_all.bmd' },
                { name: "Lethal Lava Land", filename: 'fire_land_all.bmd' },
                { name: "Lethal Lava Land - Inside the Volcano", filename: 'fire_mt_all.bmd' },
                { name: "Shifting Sand Land", filename: 'desert_land_all.bmd' },
                { name: "Shifting Sand Land - Inside the Pyramid", filename: 'desert_py_all.bmd' },
                { name: "Dire, Dire Docks", filename: 'water_land_all.bmd' },
                { name: "Snowman's Land", filename: 'snow_land_all.bmd' },
                { name: "Snowman's Land - Inside the Igloo", filename: 'snow_kama_all.bmd' },
                { name: "Wet-Dry World", filename: 'water_city_all.bmd' },
                { name: "Tall Tall Mountain", filename: 'high_mt_all.bmd' },
                { name: "Tall Tall Mountain - Inside the Slide", filename: 'high_slider_all.bmd' },
                { name: "Tiny-Huge Island - Tiny", filename: 'tibi_deka_t_all.bmd' },
                { name: "Tiny-Huge Island - Huge", filename: 'tibi_deka_d_all.bmd' },
                { name: "Tiny-Huge Island - Inside Wiggler's Cavern", filename: 'tibi_deka_in_all.bmd' },
                { name: "Tick Tock Clock", filename: 'clock_tower_all.bmd' },
                { name: "Rainbow Ride", filename: 'rainbow_cruise_all.bmd' },
                { name: "Bowser in the Dark World", filename: 'koopa1_map_all.bmd' },
                { name: "Bowser in the Dark World - Battle", filename: 'koopa1_boss_all.bmd' },
                { name: "Bowser in the Fire Sea", filename: 'koopa2_map_all.bmd' },
                { name: "Bowser in the Fire Sea - Battle", filename: 'koopa2_boss_all.bmd' },
                { name: "Bowser in the Sky", filename: 'koopa3_map_all.bmd' },
                { name: "Bowser in the Sky - Battle", filename: 'koopa3_boss_all.bmd' },
                { name: "The Secret Aquarium", filename: 'suisou_all.bmd' },
                { name: "Wing Mario over the Rainbow", filename: 'rainbow_mario_all.bmd' },
                { name: "Tower of the Vanish Cap", filename: 'habatake_all.bmd' },
                { name: "Vanish Cap Under the Moat", filename: 'horisoko_all.bmd' },
                { name: "Cavern of the Metal Cap", filename: 'metal_switch_all.bmd' },
                { name: "", filename: 'ex_l_map_all.bmd' },
                { name: "", filename: 'ex_luigi_all.bmd' },
                { name: "", filename: 'ex_m_map_all.bmd' },
                { name: "", filename: 'ex_mario_all.bmd' },
                { name: "", filename: 'ex_w_map_all.bmd' },
                { name: "", filename: 'ex_wario_all.bmd' },
                { name: "Princess Peach's Castle - Playroom", filename: 'playroom_all.bmd' },
                { name: "Test Map A", filename: 'test_map_all.bmd' },
                { name: "Test Map B", filename: 'test_map_b_all.bmd' },
            ].map(function (entry) {
                var path = "data/sm64ds/" + entry.filename;
                var name = entry.name || entry.filename;
                return new render_1.SceneDesc(name, path);
            });
            exports_8("sceneGroup", sceneGroup = { name: name, sceneDescs: sceneDescs });
        }
    }
});
/// <reference path="../decl.d.ts" />
System.register("zelview/f3dex2", [], function(exports_9, context_9) {
    "use strict";
    var __moduleName = context_9 && context_9.id;
    var vec3, mat4, UCodeCommands, UCodeNames, name, VERTEX_SIZE, VERTEX_BYTES, N, GeometryMode, OtherModeL, tileCache, CommandDispatch, F3DEX2, DL, State;
    function readVertex(state, which, addr) {
        var rom = state.rom;
        var offs = state.lookupAddress(addr);
        var posX = rom.view.getInt16(offs, false);
        var posY = rom.view.getInt16(offs + 2, false);
        var posZ = rom.view.getInt16(offs + 4, false);
        var pos = vec3.clone([posX, posY, posZ]);
        vec3.transformMat4(pos, pos, state.mtx);
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
            for (var i = 0; i < idxData.length; i++)
                if (state.verticesDirty[idxData[i]])
                    return true;
            return false;
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
            if (mode == 3)
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
        state.mtx = mat4.clone(state.mtx);
        var rom = state.rom;
        var offs = state.lookupAddress(w1);
        var mtx = mat4.create();
        for (var x = 0; x < 4; x++) {
            for (var y = 0; y < 4; y++) {
                var mt1 = rom.view.getUint16(offs, false);
                var mt2 = rom.view.getUint16(offs + 32, false);
                mtx[(x * 4) + y] = ((mt1 << 16) | (mt2)) * (1 / 0x10000);
                offs += 2;
            }
        }
        mat4.multiply(state.mtx, state.mtx, mtx);
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
        var srcOffs = state.lookupAddress(state.textureImage.addr);
        var rom = state.rom;
        // XXX: properly implement uls/ult/lrs/lrt
        var size = ((w1 & 0x00FFF000) >> 14) + 1;
        var dst = new Uint8Array(size * 4);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, idx;
                b = state.rom.view.getUint8(srcOffs++);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, p;
                b = state.rom.view.getUint8(srcOffs++);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, p, pm;
                b = state.rom.view.getUint8(srcOffs++);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var p, b;
                b = state.rom.view.getUint8(srcOffs++);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
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
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
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
        if (texture.dstFormat == "i8") {
            for (var si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
                imgData.data[di + 0] = texture.pixels[si];
                imgData.data[di + 1] = texture.pixels[si];
                imgData.data[di + 2] = texture.pixels[si];
                imgData.data[di + 3] = 255;
            }
        }
        else if (texture.dstFormat == "i8_a8") {
            for (var si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
                imgData.data[di + 0] = texture.pixels[si];
                imgData.data[di + 1] = texture.pixels[si];
                imgData.data[di + 2] = texture.pixels[si];
                imgData.data[di + 3] = texture.pixels[si + 1];
            }
        }
        else if (texture.dstFormat == "rgba8") {
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
            if (texture.dstFormat == "i8")
                texture.pixels = new Uint8Array(texture.width * texture.height);
            else if (texture.dstFormat == "i8_a8")
                texture.pixels = new Uint8Array(texture.width * texture.height * 2);
            else if (texture.dstFormat == "rgba8")
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
        if (texture.dstFormat == "i8")
            glFormat = gl.LUMINANCE;
        else if (texture.dstFormat == "i8_a8")
            glFormat = gl.LUMINANCE_ALPHA;
        else if (texture.dstFormat == "rgba8")
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
        if (tileIdx != 0)
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
            if (cmdType == UCodeCommands.ENDDL)
                break;
            // Texture uploads need to be special.
            if (cmdType == UCodeCommands.SETTIMG) {
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
        var state = new State;
        state.gl = gl;
        state.cmds = [];
        state.textures = [];
        state.mtx = mat4.create();
        state.mtxStack = [state.mtx];
        state.vertexBuffer = new Float32Array(32 * VERTEX_SIZE);
        state.verticesDirty = [];
        state.paletteTile = {};
        state.rom = rom;
        state.banks = banks;
        runDL(state, startAddr);
        return new DL(state.cmds, state.textures);
    }
    exports_9("readDL", readDL);
    return {
        setters:[],
        execute: function() {
            vec3 = window.vec3;
            mat4 = window.mat4;
            // Zelda uses the F3DEX2 display list format. This implements
            // a simple (and probably wrong!) HLE renderer for it.
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
            UCodeNames = {};
            for (name in UCodeCommands)
                UCodeNames[UCodeCommands[name]] = name;
            // 3 pos + 2 uv + 4 color/nrm
            VERTEX_SIZE = 9;
            VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
            N = 0;
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
            DL = (function () {
                function DL(cmds, textures) {
                    this.cmds = cmds;
                    this.textures = textures;
                }
                return DL;
            }());
            exports_9("DL", DL);
            State = (function () {
                function State() {
                }
                State.prototype.lookupAddress = function (addr) {
                    return this.rom.lookupAddress(this.banks, addr);
                };
                ;
                return State;
            }());
        }
    }
});
/// <reference path="../decl.d.ts" />
System.register("zelview/zelview0", ["zelview/f3dex2"], function(exports_10, context_10) {
    "use strict";
    var __moduleName = context_10 && context_10.id;
    var F3DEX2;
    var mat4, VFSEntry, ZELVIEW0, Mesh, Headers, HeaderCommands;
    function read0String(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var L = new Array(length);
        for (var i = 0; i < length; i++) {
            var elem = buf[i];
            if (elem == 0)
                break;
            L.push(String.fromCharCode(elem));
        }
        return L.join('');
    }
    function readZELVIEW0(buffer) {
        var view = new DataView(buffer);
        var MAGIC = "ZELVIEW0";
        if (read0String(buffer, 0, MAGIC.length) != MAGIC)
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
    exports_10("readZELVIEW0", readZELVIEW0);
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
                var polys = new Uint16Array(N * 3);
                var offs = rom.lookupAddress(banks, addr);
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
                var mtx = mat4.create();
                mat4.translate(mtx, mtx, [x, y, z]);
                mat4.rotateZ(mtx, mtx, c);
                mat4.rotateY(mtx, mtx, b);
                mat4.rotateX(mtx, mtx, -a);
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
            if (cmdType == HeaderCommands.End)
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
    return {
        setters:[
            function (F3DEX2_1) {
                F3DEX2 = F3DEX2_1;
            }],
        execute: function() {
            // Loads the ZELVIEW0 format.
            mat4 = window.mat4;
            VFSEntry = (function () {
                function VFSEntry() {
                }
                return VFSEntry;
            }());
            ZELVIEW0 = (function () {
                function ZELVIEW0() {
                }
                ZELVIEW0.prototype.lookupFile = function (pStart) {
                    for (var i = 0; i < this.entries.length; i++) {
                        var entry = this.entries[i];
                        if (entry.pStart === pStart)
                            return entry;
                    }
                };
                ZELVIEW0.prototype.lookupAddress = function (banks, addr) {
                    var bankIdx = addr >>> 24;
                    var offs = addr & 0x00FFFFFF;
                    function findBank(bankIdx) {
                        switch (bankIdx) {
                            case 0x02: return banks.scene;
                            case 0x03: return banks.room;
                            default: return null;
                        }
                    }
                    var bank = findBank(bankIdx);
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
            exports_10("ZELVIEW0", ZELVIEW0);
            Mesh = (function () {
                function Mesh() {
                    this.opaque = [];
                    this.transparent = [];
                }
                return Mesh;
            }());
            Headers = (function () {
                function Headers() {
                    this.rooms = [];
                }
                return Headers;
            }());
            exports_10("Headers", Headers);
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
    }
});
/// <reference path="../decl.d.ts" />
System.register("zelview/render", ["zelview/zelview0", "viewer", "util"], function(exports_11, context_11) {
    "use strict";
    var __moduleName = context_11 && context_11.id;
    var ZELVIEW0, Viewer, util_2;
    var BG_VERT_SHADER_SOURCE, BG_FRAG_SHADER_SOURCE, BG_Program, DL_VERT_SHADER_SOURCE, DL_FRAG_SHADER_SOURCE, DL_Program, COLL_VERT_SHADER_SOURCE, COLL_FRAG_SHADER_SOURCE, COLL_Program, WATERS_VERT_SHADER_SOURCE, WATERS_FRAG_SHADER_SOURCE, WATERS_Program, Scene, SceneDesc;
    return {
        setters:[
            function (ZELVIEW0_1) {
                ZELVIEW0 = ZELVIEW0_1;
            },
            function (Viewer_2) {
                Viewer = Viewer_2;
            },
            function (util_2_1) {
                util_2 = util_2_1;
            }],
        execute: function() {
            BG_VERT_SHADER_SOURCE = " \n    attribute vec3 a_position;\n    attribute vec2 a_uv;\n    varying vec2 v_uv;\n\n    void main() {\n        gl_Position = vec4(a_position, 1.0);\n        v_uv = a_uv;\n    }\n";
            BG_FRAG_SHADER_SOURCE = "\n    precision mediump float;\n    varying vec2 v_uv;\n    uniform sampler2D u_texture;\n\n    void main() {\n        gl_FragColor = texture2D(u_texture, v_uv);\n    }\n";
            BG_Program = (function (_super) {
                __extends(BG_Program, _super);
                function BG_Program() {
                    _super.apply(this, arguments);
                    this.vert = BG_VERT_SHADER_SOURCE;
                    this.frag = BG_FRAG_SHADER_SOURCE;
                }
                BG_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return BG_Program;
            }(Viewer.Program));
            DL_VERT_SHADER_SOURCE = "\n    uniform mat4 u_modelView;\n    uniform mat4 u_projection;\n    attribute vec3 a_position;\n    attribute vec2 a_uv;\n    attribute vec4 a_color;\n    varying vec4 v_color;\n    varying vec2 v_uv;\n    uniform vec2 u_txs;\n    \n    void main() {\n        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n        v_color = a_color;\n        v_uv = a_uv * u_txs;\n    }\n";
            DL_FRAG_SHADER_SOURCE = "\n    precision mediump float;\n    varying vec2 v_uv;\n    varying vec4 v_color;\n    uniform sampler2D u_texture;\n    uniform bool u_useVertexColors;\n    uniform int u_alphaTest;\n\n    void main() {\n        gl_FragColor = texture2D(u_texture, v_uv);\n        if (u_useVertexColors)\n            gl_FragColor *= v_color;\n        if (u_alphaTest > 0 && gl_FragColor.a < 0.0125)\n            discard;\n    }\n";
            DL_Program = (function (_super) {
                __extends(DL_Program, _super);
                function DL_Program() {
                    _super.apply(this, arguments);
                    this.vert = DL_VERT_SHADER_SOURCE;
                    this.frag = DL_FRAG_SHADER_SOURCE;
                }
                DL_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.txsLocation = gl.getUniformLocation(prog, "u_txs");
                    this.useVertexColorsLocation = gl.getUniformLocation(prog, "u_useVertexColors");
                    this.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                    this.colorLocation = gl.getAttribLocation(prog, "a_color");
                    this.uvLocation = gl.getAttribLocation(prog, "a_uv");
                };
                return DL_Program;
            }(Viewer.Program));
            COLL_VERT_SHADER_SOURCE = "\n    uniform mat4 u_modelView;\n    uniform mat4 u_projection;\n    attribute vec3 a_position;\n\n    void main() {\n        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n    }\n";
            COLL_FRAG_SHADER_SOURCE = "\n    void main() {\n        gl_FragColor = vec4(1.0, 1.0, 1.0, 0.2);\n    #ifdef GL_EXT_frag_depth\n    #extension GL_EXT_frag_depth : enable\n        gl_FragDepthEXT = gl_FragCoord.z - 1e-6;\n    #endif\n    }\n";
            COLL_Program = (function (_super) {
                __extends(COLL_Program, _super);
                function COLL_Program() {
                    _super.apply(this, arguments);
                    this.vert = COLL_VERT_SHADER_SOURCE;
                    this.frag = COLL_FRAG_SHADER_SOURCE;
                }
                COLL_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return COLL_Program;
            }(Viewer.Program));
            WATERS_VERT_SHADER_SOURCE = "\n    uniform mat4 u_modelView;\n    uniform mat4 u_projection;\n    attribute vec3 a_position;\n    \n    void main() {\n        gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);\n    }\n";
            WATERS_FRAG_SHADER_SOURCE = "\n    void main() {\n        gl_FragColor = vec4(0.2, 0.6, 1.0, 0.2);\n    }\n";
            WATERS_Program = (function (_super) {
                __extends(WATERS_Program, _super);
                function WATERS_Program() {
                    _super.apply(this, arguments);
                    this.vert = WATERS_VERT_SHADER_SOURCE;
                    this.frag = WATERS_FRAG_SHADER_SOURCE;
                }
                WATERS_Program.prototype.bind = function (gl, prog) {
                    _super.prototype.bind.call(this, gl, prog);
                    this.positionLocation = gl.getAttribLocation(prog, "a_position");
                };
                return WATERS_Program;
            }(Viewer.Program));
            Scene = (function () {
                function Scene(gl, zelview0) {
                    var _this = this;
                    this.zelview0 = zelview0;
                    this.textures = [];
                    this.program_BG = new BG_Program();
                    this.program_COLL = new COLL_Program();
                    this.program_DL = new DL_Program();
                    this.program_WATERS = new WATERS_Program();
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
            SceneDesc = (function () {
                function SceneDesc(name, path) {
                    this.name = name;
                    this.path = path;
                }
                SceneDesc.prototype.createScene = function (gl) {
                    return util_2.fetch(this.path).then(function (result) {
                        var zelview0 = ZELVIEW0.readZELVIEW0(result);
                        return new Scene(gl, zelview0);
                    });
                };
                return SceneDesc;
            }());
            exports_11("SceneDesc", SceneDesc);
        }
    }
});
System.register("zelview/scenes", ["zelview/render"], function(exports_12, context_12) {
    "use strict";
    var __moduleName = context_12 && context_12.id;
    var render_2;
    var name, sceneDescs, sceneGroup;
    return {
        setters:[
            function (render_2_1) {
                render_2 = render_2_1;
            }],
        execute: function() {
            name = "Ocarina of Time";
            sceneDescs = [
                {
                    "filename": "ydan_scene",
                    "label": "Inside the Deku Tree"
                },
                {
                    "filename": "ddan_scene",
                    "label": "Dodongo's Cavern"
                },
                {
                    "filename": "bdan_scene",
                    "label": "Inside Jabu-Jabu's Belly"
                },
                {
                    "filename": "Bmori1_scene",
                    "label": "Forest Temple"
                },
                {
                    "filename": "HIDAN_scene",
                    "label": "Fire Temple"
                },
                {
                    "filename": "MIZUsin_scene",
                    "label": "Water Temple"
                },
                {
                    "filename": "jyasinzou_scene",
                    "label": "Spirit Temple"
                },
                {
                    "filename": "HAKAdan_scene",
                    "label": "Shadow Temple"
                },
                {
                    "filename": "HAKAdanCH_scene",
                    "label": "Bottom of the Well"
                },
                {
                    "filename": "ice_doukutu_scene",
                    "label": "Ice Cavern"
                },
                {
                    "filename": "ganon_scene",
                    "label": "Ganon's Castle Tower"
                },
                {
                    "filename": "men_scene",
                    "label": "Gerudo Training Grounds"
                },
                {
                    "filename": "gerudoway_scene",
                    "label": "Thieves' Hideout"
                },
                {
                    "filename": "ganontika_scene",
                    "label": "Ganon's Castle"
                },
                {
                    "filename": "ganon_sonogo_scene",
                    "label": "Ganon's Castle Tower (Crumbling)"
                },
                {
                    "filename": "ganontikasonogo_scene",
                    "label": "Ganon's Castle (Crumbling)"
                },
                {
                    "filename": "takaraya_scene",
                    "label": "Treasure Chest Contest"
                },
                {
                    "filename": "ydan_boss_scene",
                    "label": "Inside the Deku Tree (Boss)"
                },
                {
                    "filename": "ddan_boss_scene",
                    "label": "Dodongo's Cavern (Boss)"
                },
                {
                    "filename": "bdan_boss_scene",
                    "label": "Inside Jabu-Jabu's Belly (Boss)"
                },
                {
                    "filename": "moribossroom_scene",
                    "label": "Forest Temple (Boss)"
                },
                {
                    "filename": "FIRE_bs_scene",
                    "label": "Fire Temple (Boss)"
                },
                {
                    "filename": "MIZUsin_bs_scene",
                    "label": "Water Temple (Boss)"
                },
                {
                    "filename": "jyasinboss_scene",
                    "label": "Spirit Temple (Mid-Boss)"
                },
                {
                    "filename": "HAKAdan_bs_scene",
                    "label": "Shadow Temple (Boss)"
                },
                {
                    "filename": "ganon_boss_scene",
                    "label": "Second-To-Last Boss Ganondorf"
                },
                {
                    "filename": "ganon_final_scene",
                    "label": "Ganondorf, Death Scene"
                },
                {
                    "filename": "entra_scene",
                    "label": "Market Entrance (Day)"
                },
                {
                    "filename": "entra_n_scene",
                    "label": "Market Entrance (Night)"
                },
                {
                    "filename": "enrui_scene",
                    "label": "Market Entrance (Adult)"
                },
                {
                    "filename": "market_alley_scene",
                    "label": "Back Alley (Day)"
                },
                {
                    "filename": "market_alley_n_scene",
                    "label": "Back Alley (Night)"
                },
                {
                    "filename": "market_day_scene",
                    "label": "Market (Day)"
                },
                {
                    "filename": "market_night_scene",
                    "label": "Market (Night)"
                },
                {
                    "filename": "market_ruins_scene",
                    "label": "Market (Adult)"
                },
                {
                    "filename": "shrine_scene",
                    "label": "Temple of Time (Outside, Day)"
                },
                {
                    "filename": "shrine_n_scene",
                    "label": "Temple of Time (Outside, Night)"
                },
                {
                    "filename": "shrine_r_scene",
                    "label": "Temple of Time (Outside, Adult)"
                },
                {
                    "filename": "kokiri_home_scene",
                    "label": "Know-it-all Brothers"
                },
                {
                    "filename": "kokiri_home3_scene",
                    "label": "House of Twins"
                },
                {
                    "filename": "kokiri_home4_scene",
                    "label": "Mido's House"
                },
                {
                    "filename": "kokiri_home5_scene",
                    "label": "Saria's House"
                },
                {
                    "filename": "kakariko_scene",
                    "label": "Kakariko Village House"
                },
                {
                    "filename": "kakariko3_scene",
                    "label": "Back Alley Village House"
                },
                {
                    "filename": "shop1_scene",
                    "label": "Kakariko Bazaar"
                },
                {
                    "filename": "kokiri_shop_scene",
                    "label": "Kokiri Shop"
                },
                {
                    "filename": "golon_scene",
                    "label": "Goron Shop"
                },
                {
                    "filename": "zoora_scene",
                    "label": "Zora Shop"
                },
                {
                    "filename": "drag_scene",
                    "label": "Kakariko Potion Shop"
                },
                {
                    "filename": "alley_shop_scene",
                    "label": "Market Potion Shop"
                },
                {
                    "filename": "night_shop_scene",
                    "label": "Bombchu Shop"
                },
                {
                    "filename": "face_shop_scene",
                    "label": "Happy Mask Shop"
                },
                {
                    "filename": "link_home_scene",
                    "label": "Link's House"
                },
                {
                    "filename": "impa_scene",
                    "label": "Puppy Woman's House"
                },
                {
                    "filename": "malon_stable_scene",
                    "label": "Stables"
                },
                {
                    "filename": "labo_scene",
                    "label": "Impa's House"
                },
                {
                    "filename": "hylia_labo_scene",
                    "label": "Lakeside Laboratory"
                },
                {
                    "filename": "tent_scene",
                    "label": "Carpenter's Tent"
                },
                {
                    "filename": "hut_scene",
                    "label": "Dampé's Hut"
                },
                {
                    "filename": "daiyousei_izumi_scene",
                    "label": "Great Fairy Fountain"
                },
                {
                    "filename": "yousei_izumi_tate_scene",
                    "label": "Small Fairy Fountain"
                },
                {
                    "filename": "yousei_izumi_yoko_scene",
                    "label": "Magic Fairy Fountain"
                },
                {
                    "filename": "kakusiana_scene",
                    "label": "Grottos"
                },
                {
                    "filename": "hakaana_scene",
                    "label": "Grave (1)"
                },
                {
                    "filename": "hakaana2_scene",
                    "label": "Grave (2)"
                },
                {
                    "filename": "hakaana_ouke_scene",
                    "label": "Royal Family's Tomb"
                },
                {
                    "filename": "syatekijyou_scene",
                    "label": "Shooting Gallery"
                },
                {
                    "filename": "tokinoma_scene",
                    "label": "Temple of Time Inside"
                },
                {
                    "filename": "kenjyanoma_scene",
                    "label": "Chamber of Sages"
                },
                {
                    "filename": "hairal_niwa_scene",
                    "label": "Castle Courtyard (Day)"
                },
                {
                    "filename": "hairal_niwa_n_scene",
                    "label": "Castle Courtyard (Night)"
                },
                {
                    "filename": "hiral_demo_scene",
                    "label": "Cutscene Map"
                },
                {
                    "filename": "hakasitarelay_scene",
                    "label": "Dampé's Grave & Kakariko Windmill"
                },
                {
                    "filename": "turibori_scene",
                    "label": "Fishing Pond"
                },
                {
                    "filename": "nakaniwa_scene",
                    "label": "Zelda's Courtyard"
                },
                {
                    "filename": "bowling_scene",
                    "label": "Bombchu Bowling Alley"
                },
                {
                    "filename": "souko_scene",
                    "label": "Talon's House"
                },
                {
                    "filename": "miharigoya_scene",
                    "label": "Lots'o Pots"
                },
                {
                    "filename": "mahouya_scene",
                    "label": "Granny's Potion Shop"
                },
                {
                    "filename": "ganon_demo_scene",
                    "label": "Final Battle against Ganon"
                },
                {
                    "filename": "kinsuta_scene",
                    "label": "Skulltula House"
                },
                {
                    "filename": "spot00_scene",
                    "label": "Hyrule Field"
                },
                {
                    "filename": "spot01_scene",
                    "label": "Kakariko Village"
                },
                {
                    "filename": "spot02_scene",
                    "label": "Kakariko Graveyard"
                },
                {
                    "filename": "spot03_scene",
                    "label": "Zora's River"
                },
                {
                    "filename": "spot04_scene",
                    "label": "Kokiri Forest"
                },
                {
                    "filename": "spot05_scene",
                    "label": "Sacred Forest Meadow"
                },
                {
                    "filename": "spot06_scene",
                    "label": "Lake Hylia"
                },
                {
                    "filename": "spot07_scene",
                    "label": "Zora's Domain"
                },
                {
                    "filename": "spot08_scene",
                    "label": "Zora's Fountain"
                },
                {
                    "filename": "spot09_scene",
                    "label": "Gerudo Valley"
                },
                {
                    "filename": "spot10_scene",
                    "label": "Lost Woods"
                },
                {
                    "filename": "spot11_scene",
                    "label": "Desert Colossus"
                },
                {
                    "filename": "spot12_scene",
                    "label": "Gerudo's Fortress"
                },
                {
                    "filename": "spot13_scene",
                    "label": "Haunted Wasteland"
                },
                {
                    "filename": "spot15_scene",
                    "label": "Hyrule Castle"
                },
                {
                    "filename": "spot16_scene",
                    "label": "Death Mountain"
                },
                {
                    "filename": "spot17_scene",
                    "label": "Death Mountain Crater"
                },
                {
                    "filename": "spot18_scene",
                    "label": "Goron City"
                },
                {
                    "filename": "spot20_scene",
                    "label": "Lon Lon Ranch"
                },
                {
                    "filename": "ganon_tou_scene",
                    "label": "Ganon's Tower (Outside)"
                },
                {
                    "filename": "test01_scene",
                    "label": "Collision Testing Area"
                },
                {
                    "filename": "besitu_scene",
                    "label": "Besitu / Treasure Chest Warp"
                },
                {
                    "filename": "depth_test_scene",
                    "label": "Depth Test"
                },
                {
                    "filename": "syotes_scene",
                    "label": "Stalfos Middle Room"
                },
                {
                    "filename": "syotes2_scene",
                    "label": "Stalfos Boss Room"
                },
                {
                    "filename": "sutaru_scene",
                    "label": "Dark Link Testing Area"
                },
                {
                    "filename": "hairal_niwa2_scene",
                    "label": "Beta Castle Courtyard"
                },
                {
                    "filename": "sasatest_scene",
                    "label": "Action Testing Room"
                },
                {
                    "filename": "testroom_scene",
                    "label": "Item Testing Room"
                }
            ].map(function (entry) {
                var path = "data/zelview/" + entry.filename + ".zelview0";
                return new render_2.SceneDesc(entry.label, path);
            });
            exports_12("sceneGroup", sceneGroup = { name: name, sceneDescs: sceneDescs });
        }
    }
});
System.register("main", ["viewer", "sm64ds/scenes", "zelview/scenes"], function(exports_13, context_13) {
    "use strict";
    var __moduleName = context_13 && context_13.id;
    var viewer_1, SM64DS, ZELVIEW;
    var Main;
    return {
        setters:[
            function (viewer_1_1) {
                viewer_1 = viewer_1_1;
            },
            function (SM64DS_1) {
                SM64DS = SM64DS_1;
            },
            function (ZELVIEW_1) {
                ZELVIEW = ZELVIEW_1;
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
                    this.groups.push(ZELVIEW.sceneGroup);
                    this.makeUI();
                }
                Main.prototype.loadSceneDesc = function (sceneDesc) {
                    var _this = this;
                    var gl = this.viewer.sceneGraph.renderState.viewport.gl;
                    sceneDesc.createScene(gl).then(function (result) {
                        _this.viewer.setScene(result);
                        var textures = document.querySelector('#textures');
                        textures.innerHTML = '';
                        result.textures.forEach(function (canvas) {
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
            exports_13("Main", Main);
            window.addEventListener('load', function () {
                window.main = new Main();
            });
        }
    }
});
//# sourceMappingURL=main.js.map