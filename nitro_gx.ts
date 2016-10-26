namespace NITRO_GX {

    // Read DS Geometry Engine commands.

    var NITRO_GX_Cmds = {
        MTX_RESTORE: 0x14,

        COLOR:       0x20,
        NORMAL:      0x21,
        TEXCOORD:    0x22,
        VTX_16:      0x23,
        VTX_10:      0x24,
        VTX_XY:      0x25,
        VTX_XZ:      0x26,
        VTX_YZ:      0x27,
        VTX_DIFF:    0x28,

        DIF_AMB:     0x30,

        BEGIN_VTXS:  0x40,
        END_VTXS:    0x41,
    };

    // 3 pos + 4 color + 2 uv
    var VERTEX_SIZE = 9;
    var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

    export function rgb5(pixel) {
        var r, g, b;
        r = (pixel & 0x7c00) >> 10;
        r = (r << (8-5)) | (r >> (10-8));

        g = (pixel & 0x3e0) >> 5;
        g = (g << (8-5)) | (g >> (10-8));

        b = pixel & 0x1f;
        b = (b << (8-5)) | (b >> (10-8));

        return [b, g, r];
    }

    function cmd_MTX_RESTORE(ctx) { ctx.readParam(); }

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

        ctx.s_texCoord = [s, t];
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

        ctx.vtx(x, y, ctx.s_vtx[2]);
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

        ctx.vtx(x, ctx.s_vtx[1], z);
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

        ctx.vtx(ctx.s_vtx[0], y, z);
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
        x += ctx.s_vtx[0];
        y += ctx.s_vtx[1];
        z += ctx.s_vtx[2];

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

            vtxArray[0] = v.pos[0];
            vtxArray[1] = v.pos[1];
            vtxArray[2] = v.pos[2];

            vtxArray[3] = v.color[0] / 0xFF;
            vtxArray[4] = v.color[1] / 0xFF;
            vtxArray[5] = v.color[2] / 0xFF;
            vtxArray[6] = ctx.alpha / 0xFF;

            vtxArray[7] = v.uv[0];
            vtxArray[8] = v.uv[1];
        }

        var idxBuffer;

        if (ctx.s_polyType === 0) {
            // Triangles
            idxBuffer = new Uint16Array(nVerts);
            for (var i = 0; i < nVerts; i++)
                idxBuffer[i] = i;
        } else if (ctx.s_polyType === 1) {
            // Quads
            idxBuffer = new Uint16Array(nVerts / 4 * 6);
            var dst = 0;
            for (var i = 0; i < nVerts; i += 4) {
                idxBuffer[dst++] = i+0;
                idxBuffer[dst++] = i+1;
                idxBuffer[dst++] = i+2;
                idxBuffer[dst++] = i+2;
                idxBuffer[dst++] = i+3;
                idxBuffer[dst++] = i+0;
            }
        } else if (ctx.s_polyType === 2) {
            // Triangle strips
            idxBuffer = new Uint16Array((nVerts - 2) * 3);
            var dst = 0;
            for (var i = 0; i < nVerts - 2; i++) {
                if (i % 2 === 0) {
                    idxBuffer[dst++] = i+0;
                    idxBuffer[dst++] = i+1;
                    idxBuffer[dst++] = i+2;
                } else {
                    idxBuffer[dst++] = i+1;
                    idxBuffer[dst++] = i+0;
                    idxBuffer[dst++] = i+2;
                }
            }
        } else if (ctx.s_polyType === 3) {
            // Quad strips
            idxBuffer = new Uint16Array(((nVerts - 2) / 2) * 6);
            var dst = 0;
            for (var i = 0; i < nVerts; i += 2) {
                idxBuffer[dst++] = i+0;
                idxBuffer[dst++] = i+1;
                idxBuffer[dst++] = i+3;
                idxBuffer[dst++] = i+3;
                idxBuffer[dst++] = i+2;
                idxBuffer[dst++] = i+0;
            }
        }

        var packet:any = {};
        packet.vertData = vtxBuffer;
        packet.idxData = idxBuffer;
        packet.polyType = ctx.s_polyType;
        ctx.packets.push(packet);

        ctx.vtxs = null;
    }

    function runCmd(ctx, cmd) {
        switch (cmd) {
        case 0: return;
        case NITRO_GX_Cmds.MTX_RESTORE: return cmd_MTX_RESTORE(ctx);
        case NITRO_GX_Cmds.COLOR:       return cmd_COLOR(ctx);
        case NITRO_GX_Cmds.NORMAL:      return cmd_NORMAL(ctx);
        case NITRO_GX_Cmds.TEXCOORD:    return cmd_TEXCOORD(ctx);
        case NITRO_GX_Cmds.VTX_16:      return cmd_VTX_16(ctx);
        case NITRO_GX_Cmds.VTX_10:      return cmd_VTX_10(ctx);
        case NITRO_GX_Cmds.VTX_XY:      return cmd_VTX_XY(ctx);
        case NITRO_GX_Cmds.VTX_XZ:      return cmd_VTX_XZ(ctx);
        case NITRO_GX_Cmds.VTX_YZ:      return cmd_VTX_YZ(ctx);
        case NITRO_GX_Cmds.VTX_DIFF:    return cmd_VTX_DIFF(ctx);
        case NITRO_GX_Cmds.DIF_AMB:     return cmd_DIF_AMB(ctx);
        case NITRO_GX_Cmds.BEGIN_VTXS:  return cmd_BEGIN_VTXS(ctx);
        case NITRO_GX_Cmds.END_VTXS:    return cmd_END_VTXS(ctx);
        default: console.warn("Missing command", cmd.toString(16));
        }
    }

    export function readCmds(buffer, baseCtx) {
        var ctx = Object.create(baseCtx);

        ctx.view = new DataView(buffer);
        ctx.offs = 0;
        ctx.s_texCoord = [0, 0];

        ctx.readParam = function() {
            return ctx.view.getUint32((ctx.offs += 4) - 4, true);
        };
        ctx.vtx = function(x, y, z) {
            ctx.s_vtx = [x, y, z];
            ctx.vtxs.push({ pos: ctx.s_vtx, nrm: ctx.s_nrm, color: ctx.s_color, uv: ctx.s_texCoord });
        };

        ctx.packets = [];

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

}
