// gimmick.ts
// represents a dynamic or interactable object in levels, such as treasure boxes or warp pads

import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { vec3 } from "gl-matrix";
import { fshp_renderer } from "./render_fshp";

export class gimmick
{
    public fshp_renderers: fshp_renderer[] = [];

    // rotation: euler XYZ rotation in degrees
    constructor (position: vec3, rotation: vec3, scale: vec3, fres: FRES, device: GfxDevice, renderHelper: GfxRenderHelper)
    {
        //initialize textures
        const bntx = BNTX.parse(fres.embedded_files[0].buffer);
        const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

        // create all fshp_renderers
        const fmdl = fres.fmdl[0];
        const shapes = fmdl.fshp;
        for (let i = 0; i < shapes.length; i++)
        {
            const renderer = new fshp_renderer(device, renderHelper, fmdl, i, bntx, gfx_texture_array, position, rotation, scale);
            this.fshp_renderers.push(renderer);
        }
    }
}
