// mannequinbig.ts
// the large maid dress mannequins in Illusory 106

import { APAK, get_files_of_type } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { gimmick } from "./gimmick";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { vec3 } from "gl-matrix";
import { LayoutPoint } from "./maplayout";

export class MannequinBig extends gimmick
{
    private animations: FRES[];

    constructor(layout_point: LayoutPoint, model_fres: FRES, animation_fres_array: FRES[], device: GfxDevice)
    {
        super
        (
            layout_point.position,
            layout_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            model_fres, device,
            new GfxRenderHelper(device),
            animation_fres_array[2],
        );

        this.animations = animation_fres_array;
        this.fmdl_renderer.animation_play = false;
    }
}
