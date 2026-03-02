// mannequinbig.ts
// the large maid dress mannequins in Illusory 106

import { AABB } from "../Geometry.js";
import * as BFRES from "../fres_nx/bfres.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { gimmick } from "./gimmick";
import { vec3 } from "gl-matrix";
import { LayoutPoint } from "./maplayout";

export class MannequinBig extends gimmick
{
    private animations: BFRES.FRES[];

    constructor(layout_point: LayoutPoint, model_fres: BFRES.FRES, animation_fres_array: BFRES.FRES[], device: GfxDevice)
    {
        let bounding_box = new AABB();
        const bb_center = vec3.fromValues(layout_point.position[0], layout_point.position[1] + 75.0, layout_point.position[2]);
        const bb_extents = vec3.fromValues(150, 125, 150);
        bounding_box.setFromCenterAndHalfExtents(bb_center, bb_extents);

        super
        (
            layout_point.position,
            layout_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            model_fres,
            device,
            new GfxRenderHelper(device),
            animation_fres_array[0],
            bounding_box,
        );

        this.animations = animation_fres_array;
        this.fmdl_renderer.animation_play = false;
    }
}
