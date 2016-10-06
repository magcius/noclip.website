(function(exports) {
    "use strict";

    // Read DS texture formats.

    var Format = {
        Tex_None:       0x00,
        Tex_A3I5:       0x01,
        Tex_Palette4:   0x02,
        Tex_Palette16:  0x03,
        Tex_Palette256: 0x04,
        Tex_CMPR_4x4:   0x05,
        Tex_A5I3:       0x06,
        Tex_Direct:     0x07,
    };

    function color(a, r, g, b) {
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    function rgb5(pixel, alpha) {
        var r, g, b;
        r = (pixel & 0x7c00) >>> 10;
        r = (r << (8-5)) | (r >>> (10-8));

        g = (pixel & 0x3e0) >>> 5;
        g = (g << (8-5)) | (g >>> (10-8));

        b = pixel & 0x1f;
        b = (b << (8-5)) | (b >>> (10-8));

        return color(alpha, r, g, b);
    }

    function writeColor(pixels, dstPixel, pixel) {
        var dstOffs = dstPixel * 4;
        var a = ((pixel >>> 24) & 0xFF);
        var r = ((pixel >>> 16) & 0xFF);
        var g = ((pixel >>>  8) & 0xFF);
        var b = ((pixel >>>  0) & 0xFF);
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
                alpha = (alpha << (8-3)) | (alpha >>> (6-8));
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
            var g = (((p1 >>>  8) & 0xFF) + ((p2 >>>  8) & 0xFF)) >>> 1;
            var b = (((p1 >>>  0) & 0xFF) + ((p2 >>>  0) & 0xFF)) >>> 1;
            return color(a, r, g, b);
        }

        function mixs3(p1, p2) {
            // p1*(5/8) + p2*(3/8)
            var a1 = ((p1 >>> 24) & 0xFF);
            var r1 = ((p1 >>> 16) & 0xFF);
            var g1 = ((p1 >>>  8) & 0xFF);
            var b1 = ((p1 >>>  0) & 0xFF);

            var a2 = ((p2 >>> 24) & 0xFF);
            var r2 = ((p2 >>> 16) & 0xFF);
            var g2 = ((p2 >>>  8) & 0xFF);
            var b2 = ((p2 >>>  0) & 0xFF);

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
            } else if (palMode === 1) {
                // PTY=1, A=0
                // Color2 is a blend of Color1/Color2.
                palette[2] = mix(palette[0], palette[1]);
                palette[3] = 0x00000000;
            } else if (palMode === 2) {
                // PTY=0, A=1
                palette[2] = getPal(palOffs + 0x04);
                palette[3] = getPal(palOffs + 0x06);
            } else {
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
                alpha = (alpha << (8-5)) | (alpha >>> (10-8));
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
        case Format.Tex_A3I5:      return readTexture_A3I5(width, height, texData, palData);
        case Format.Tex_Palette16: return readTexture_Palette16(width, height, texData, palData, color0);
        case Format.Tex_CMPR_4x4:  return readTexture_CMPR_4x4(width, height, texData, palData);
        case Format.Tex_A5I3:      return readTexture_A5I3(width, height, texData, palData);
        case Format.Tex_Direct:    return readTexture_Direct(width, height, texData);
        default: return console.warn("Unsupported texture format", format);
        }
    }

    var NITRO_Tex = {};
    NITRO_Tex.Format = Format;
    NITRO_Tex.readTexture = readTexture;
    exports.NITRO_Tex = NITRO_Tex;

})(window);
