// Nintendo DS LZ77 (LZ10) format.
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
var LZ77;
(function (LZ77) {
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
    LZ77.decompress = decompress;
})(LZ77 || (LZ77 = {}));
var NITRO_GX;
(function (NITRO_GX) {
    // Read DS Geometry Engine commands.
    var CmdType;
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
    var PolyType;
    (function (PolyType) {
        PolyType[PolyType["TRIANGLES"] = 0] = "TRIANGLES";
        PolyType[PolyType["QUADS"] = 1] = "QUADS";
        PolyType[PolyType["TRIANGLE_STRIP"] = 2] = "TRIANGLE_STRIP";
        PolyType[PolyType["QUAD_STRIP"] = 3] = "QUAD_STRIP";
    })(PolyType || (PolyType = {}));
    // 3 pos + 4 color + 2 uv
    var VERTEX_SIZE = 9;
    var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
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
    NITRO_GX.rgb5 = rgb5;
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
    var Packet = (function () {
        function Packet() {
        }
        return Packet;
    }());
    NITRO_GX.Packet = Packet;
    ;
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
    var Color = (function () {
        function Color() {
        }
        return Color;
    }());
    ;
    var TexCoord = (function () {
        function TexCoord() {
        }
        return TexCoord;
    }());
    ;
    var Point = (function () {
        function Point() {
        }
        return Point;
    }());
    ;
    var Vertex = (function () {
        function Vertex() {
        }
        return Vertex;
    }());
    ;
    var Context = (function () {
        function Context() {
        }
        return Context;
    }());
    NITRO_GX.Context = Context;
    ;
    var ContextInternal = (function () {
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
    NITRO_GX.readCmds = readCmds;
})(NITRO_GX || (NITRO_GX = {}));
var NITRO_Tex;
(function (NITRO_Tex) {
    // Read DS texture formats.
    (function (Format) {
        Format[Format["Tex_None"] = 0] = "Tex_None";
        Format[Format["Tex_A3I5"] = 1] = "Tex_A3I5";
        Format[Format["Tex_Palette4"] = 2] = "Tex_Palette4";
        Format[Format["Tex_Palette16"] = 3] = "Tex_Palette16";
        Format[Format["Tex_Palette256"] = 4] = "Tex_Palette256";
        Format[Format["Tex_CMPR_4x4"] = 5] = "Tex_CMPR_4x4";
        Format[Format["Tex_A5I3"] = 6] = "Tex_A5I3";
        Format[Format["Tex_Direct"] = 7] = "Tex_Direct";
    })(NITRO_Tex.Format || (NITRO_Tex.Format = {}));
    var Format = NITRO_Tex.Format;
    ;
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
    NITRO_Tex.readTexture = readTexture;
})(NITRO_Tex || (NITRO_Tex = {}));
/// <reference path="nitro_gx.ts" />
/// <reference path="nitro_tex.ts" />
var NITRO_BMD;
(function (NITRO_BMD) {
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
    var Poly = (function () {
        function Poly() {
        }
        return Poly;
    }());
    var Batch = (function () {
        function Batch() {
        }
        return Batch;
    }());
    ;
    var Model = (function () {
        function Model() {
        }
        return Model;
    }());
    ;
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
    function textureToCanvas(texture) {
        var canvas = document.createElement("canvas");
        canvas.width = texture.width;
        canvas.height = texture.height;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);
        for (var i = 0; i < imgData.data.length; i++)
            imgData.data[i] = texture.pixels[i];
        canvas.title = texture.name;
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }
    var Texture = (function () {
        function Texture() {
        }
        return Texture;
    }());
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
        if (texture.pixels)
            document.querySelector('#textures').appendChild(textureToCanvas(texture));
        texture.isTranslucent = (texture.format === NITRO_Tex.Format.Tex_A5I3 ||
            texture.format === NITRO_Tex.Format.Tex_A3I5);
        return texture;
    }
    var BMD = (function () {
        function BMD() {
        }
        return BMD;
    }());
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
        bmd.models = [];
        for (var i = 0; i < bmd.modelCount; i++)
            bmd.models.push(parseModel(bmd, view, i));
        return bmd;
    }
    NITRO_BMD.parse = parse;
    ;
})(NITRO_BMD || (NITRO_BMD = {}));
/// <reference path="nitro_bmd.ts">
var Render;
(function (Render) {
    function fetch(path, responseType) {
        if (responseType === void 0) { responseType = "arraybuffer"; }
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = responseType;
        request.send();
        return request;
    }
    // A dumb hack to have "multiline strings".
    function M(X) { return X.join('\n'); }
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
    var DL_VERT_SHADER_SOURCE = M([
        'precision mediump float;',
        'uniform mat4 u_modelView;',
        'uniform mat4 u_localMatrix;',
        'uniform mat4 u_projection;',
        'uniform mat4 u_texCoordMat;',
        'attribute vec3 a_position;',
        'attribute vec2 a_uv;',
        'attribute vec4 a_color;',
        'varying vec4 v_color;',
        'varying vec2 v_uv;',
        '',
        'void main() {',
        '    gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);',
        '    v_color = a_color;',
        '    v_uv = (u_texCoordMat * vec4(a_uv, 1.0, 1.0)).st;',
        '}',
    ]);
    var DL_FRAG_SHADER_SOURCE = M([
        'precision mediump float;',
        'varying vec2 v_uv;',
        'varying vec4 v_color;',
        'uniform sampler2D u_texture;',
        '',
        'void main() {',
        '    gl_FragColor = texture2D(u_texture, v_uv);',
        '    gl_FragColor *= v_color;',
        '    if (gl_FragColor.a == 0.0)',
        '        discard;',
        '}',
    ]);
    function createProgram_DL(gl) {
        var vertShader = compileShader(gl, DL_VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
        var fragShader = compileShader(gl, DL_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
        var prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        prog.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        prog.projectionLocation = gl.getUniformLocation(prog, "u_projection");
        prog.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
        prog.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
        prog.txsLocation = gl.getUniformLocation(prog, "u_txs");
        prog.positionLocation = gl.getAttribLocation(prog, "a_position");
        prog.colorLocation = gl.getAttribLocation(prog, "a_color");
        prog.uvLocation = gl.getAttribLocation(prog, "a_uv");
        return prog;
    }
    // 3 pos + 4 color + 2 uv
    var VERTEX_SIZE = 9;
    var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;
    function translateBMD(gl, bmd) {
        var model = {};
        var RenderPass = {
            OPAQUE: 0x01,
            TRANSLUCENT: 0x02,
        };
        function translatePacket(packet) {
            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);
            var idxBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);
            return function () {
                var prog = gl.currentProgram;
                gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
                gl.vertexAttribPointer(prog.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
                gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
                gl.enableVertexAttribArray(prog.positionLocation);
                gl.enableVertexAttribArray(prog.colorLocation);
                gl.enableVertexAttribArray(prog.uvLocation);
                gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
                gl.disableVertexAttribArray(prog.positionLocation);
                gl.disableVertexAttribArray(prog.colorLocation);
                gl.disableVertexAttribArray(prog.uvLocation);
            };
        }
        function translatePoly(poly) {
            var funcs = poly.packets.map(translatePacket);
            return function (state) {
                funcs.forEach(function (f) { f(state); });
            };
        }
        function translateMaterial(material) {
            var texture = material.texture;
            if (texture !== null) {
                var texId = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                var repeatS = (material.texParams >> 16) & 0x01;
                var repeatT = (material.texParams >> 17) & 0x01;
                var flipS = (material.texParams >> 18) & 0x01;
                var flipT = (material.texParams >> 19) & 0x01;
                function wrapMode(repeat, flip) {
                    if (repeat)
                        return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
                    else
                        return gl.CLAMP_TO_EDGE;
                }
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
            }
            return function (state) {
                if (texture !== null) {
                    gl.uniformMatrix4fv(gl.currentProgram.texCoordMatLocation, false, material.texCoordMat);
                    gl.bindTexture(gl.TEXTURE_2D, texId);
                }
                gl.depthMask(material.depthWrite);
            };
        }
        function translateBatch(batch) {
            var batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;
            var applyMaterial = translateMaterial(batch.material);
            var renderPoly = translatePoly(batch.poly);
            return function (state) {
                if (state.renderPass != batchPass)
                    return;
                applyMaterial(state);
                renderPoly(state);
            };
        }
        function translateModel(bmdm) {
            var localMatrix = window.mat4.create();
            window.mat4.scale(localMatrix, localMatrix, [bmd.scaleFactor, bmd.scaleFactor, bmd.scaleFactor]);
            var batches = bmdm.batches.map(translateBatch);
            return function (state) {
                gl.uniformMatrix4fv(gl.currentProgram.localMatrixLocation, false, localMatrix);
                batches.forEach(function (f) { f(state); });
            };
        }
        var modelFuncs = bmd.models.map(translateModel);
        function renderModels(state) {
            modelFuncs.forEach(function (f) { f(state); });
        }
        model.render = function (state) {
            state.useProgram(state.programs_DL);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            // First pass, opaque.
            state.renderPass = RenderPass.OPAQUE;
            renderModels(state);
            // Second pass, translucent.
            state.renderPass = RenderPass.TRANSLUCENT;
            renderModels(state);
        };
        return model;
    }
    function createSceneGraph(gl) {
        var projection = window.mat4.create();
        window.mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.2, 50000);
        var view = window.mat4.create();
        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clearColor(200 / 255, 50 / 255, 153 / 255, 1);
        var models = [];
        var scene = {};
        var state = {};
        state.gl = gl;
        state.programs_DL = createProgram_DL(gl);
        state.useProgram = function (prog) {
            gl.currentProgram = prog;
            gl.useProgram(prog);
            gl.uniformMatrix4fv(prog.projectionLocation, false, projection);
            gl.uniformMatrix4fv(prog.modelViewLocation, false, view);
            return prog;
        };
        function renderModel(model) {
            model.render(state);
        }
        function render() {
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            models.forEach(renderModel);
        }
        scene.setModels = function (models_) {
            models = models_;
            render();
        };
        scene.setCamera = function (matrix) {
            window.mat4.invert(view, matrix);
            render();
        };
        scene.render = function () {
            render();
        };
        return scene;
    }
    function createViewer() {
        var canvas = document.querySelector("canvas");
        var gl = canvas.getContext("webgl", { alpha: false });
        gl.viewportWidth = canvas.width;
        gl.viewportHeight = canvas.height;
        var scene = createSceneGraph(gl);
        var camera = window.mat4.create();
        var filename = '';
        var viewer = {};
        viewer.gl = gl;
        viewer.resetCamera = function () {
            window.mat4.identity(camera);
            scene.setCamera(camera);
        };
        viewer.setBMD = function (bmd) {
            var model = translateBMD(gl, bmd);
            scene.setModels([model]);
            viewer.resetCamera();
        };
        viewer.loadScene = function (filename) {
            fetch(filename).onload = function () {
                var textures = document.querySelector('#textures');
                textures.innerHTML = '';
                var r = this.response;
                var decompressed = LZ77.decompress(r);
                var bmd = NITRO_BMD.parse(decompressed);
                viewer.setBMD(bmd);
            };
        };
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
        function update(nt) {
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
            scene.setCamera(camera);
            window.requestAnimationFrame(update);
        }
        update(0);
        return viewer;
    }
    var manifest = [
        { filename: 'data/sm64ds/battan_king_map_all.bmd', },
        { filename: 'data/sm64ds/bombhei_map_all.bmd', },
        { filename: 'data/sm64ds/castle_1f_all.bmd', },
        { filename: 'data/sm64ds/castle_2f_all.bmd', },
        { filename: 'data/sm64ds/castle_b1_all.bmd', },
        { filename: 'data/sm64ds/cave_all.bmd', },
        { filename: 'data/sm64ds/clock_tower_all.bmd', },
        { filename: 'data/sm64ds/desert_land_all.bmd', },
        { filename: 'data/sm64ds/desert_py_all.bmd', },
        { filename: 'data/sm64ds/ex_l_map_all.bmd', },
        { filename: 'data/sm64ds/ex_luigi_all.bmd', },
        { filename: 'data/sm64ds/ex_m_map_all.bmd', },
        { filename: 'data/sm64ds/ex_mario_all.bmd', },
        { filename: 'data/sm64ds/ex_w_map_all.bmd', },
        { filename: 'data/sm64ds/ex_wario_all.bmd', },
        { filename: 'data/sm64ds/fire_land_all.bmd', },
        { filename: 'data/sm64ds/fire_mt_all.bmd', },
        { filename: 'data/sm64ds/habatake_all.bmd', },
        { filename: 'data/sm64ds/high_mt_all.bmd', },
        { filename: 'data/sm64ds/high_slider_all.bmd', },
        { filename: 'data/sm64ds/horisoko_all.bmd', },
        { filename: 'data/sm64ds/kaizoku_irie_all.bmd', },
        { filename: 'data/sm64ds/kaizoku_ship_all.bmd', },
        { filename: 'data/sm64ds/koopa1_boss_all.bmd', },
        { filename: 'data/sm64ds/koopa1_map_all.bmd', },
        { filename: 'data/sm64ds/koopa2_boss_all.bmd', },
        { filename: 'data/sm64ds/koopa2_map_all.bmd', },
        { filename: 'data/sm64ds/koopa3_boss_all.bmd', },
        { filename: 'data/sm64ds/koopa3_map_all.bmd', },
        { filename: 'data/sm64ds/main_castle_all.bmd', },
        { filename: 'data/sm64ds/main_garden_all.bmd', },
        { filename: 'data/sm64ds/metal_switch_all.bmd', },
        { filename: 'data/sm64ds/playroom_all.bmd', },
        { filename: 'data/sm64ds/rainbow_cruise_all.bmd', },
        { filename: 'data/sm64ds/rainbow_mario_all.bmd', },
        { filename: 'data/sm64ds/snow_kama_all.bmd', },
        { filename: 'data/sm64ds/snow_land_all.bmd', },
        { filename: 'data/sm64ds/snow_mt_all.bmd', },
        { filename: 'data/sm64ds/snow_slider_all.bmd', },
        { filename: 'data/sm64ds/suisou_all.bmd', },
        { filename: 'data/sm64ds/teresa_house_all.bmd', },
        { filename: 'data/sm64ds/test_map_all.bmd', },
        { filename: 'data/sm64ds/test_map_b_all.bmd', },
        { filename: 'data/sm64ds/tibi_deka_d_all.bmd', },
        { filename: 'data/sm64ds/tibi_deka_in_all.bmd', },
        { filename: 'data/sm64ds/tibi_deka_t_all.bmd', },
        { filename: 'data/sm64ds/water_city_all.bmd', },
        { filename: 'data/sm64ds/water_land_all.bmd', },
    ];
    function sceneCombo(gl, viewer) {
        var pl = document.querySelector('#pl');
        var select = document.createElement('select');
        manifest.forEach(function (entry) {
            var option = document.createElement('option');
            option.textContent = entry.filename;
            option.filename = entry.filename;
            select.appendChild(option);
        });
        pl.appendChild(select);
        var button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', function () {
            var option = select.childNodes[select.selectedIndex];
            viewer.loadScene(option.filename);
        });
        pl.appendChild(button);
    }
    window.addEventListener('load', function () {
        var viewer = createViewer();
        sceneCombo(viewer.gl, viewer);
    });
})(Render || (Render = {}));
;
//# sourceMappingURL=main.js.map