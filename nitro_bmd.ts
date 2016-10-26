
// Workaround for not having gl-matrix typings available.
interface Window {
    mat4: any;
}

namespace NITRO_BMD {

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

        var model:any = {};
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
            var baseCtx = { s_color: material.diffuse, alpha: material.alpha };

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

        return { packets: NITRO_GX.readCmds(gxCmdBuf, baseCtx) };
    }

    function parseMaterial(bmd, view, idx) {
        var offs = bmd.materialOffsBase + idx * 0x30;

        var material:any = {};
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
            window.mat4.scale(material.texCoordMat, material.texCoordMat, [1/material.texture.width, 1/material.texture.height, 1]);
        } else {
            material.texture = null;
            material.texParams = 0;
        }

        var polyAttribs = view.getUint32(offs + 0x24, true);
        var alpha = (polyAttribs >> 16) & 0x1F;
        alpha = (alpha << (8-5)) | (alpha >>> (10-8));  

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

    function parseTexture(bmd, view, texIdx, palIdx) {
        var texOffs = bmd.textureOffsBase + texIdx * 0x14;

        var texture:any = {};
        texture.id = texIdx;
        texture.name = readString(view.buffer, view.getUint32(texOffs + 0x00, true), 0xFF);

        var texDataOffs = view.getUint32(texOffs + 0x04, true);
        var texDataSize = view.getUint32(texOffs + 0x08, true);
        var texData = view.buffer.slice(texDataOffs);

        texture.params = view.getUint32(texOffs + 0x10, true);
        texture.format = (texture.params >> 26) & 0x07;
        texture.width = 8 << ((texture.params >> 20) & 0x07);
        texture.height = 8 << ((texture.params >> 23) & 0x07);
        var color0 = (texture.params >> 29) & 0x01;

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

    export function parse(buffer) {
        var view = new DataView(buffer);

        var bmd:any = {};

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
    };

}
