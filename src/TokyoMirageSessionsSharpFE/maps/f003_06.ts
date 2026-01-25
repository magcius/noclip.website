// f003_06.ts
// Café Seiren

import { get_animations_from_apak, get_fres_from_apak } from "../apak.js";
import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "./../maplayout.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";

export async function create_f003_06_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const ilyana_model_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/nonplayer/np122/skin/01/model.apak", "np122_01.bfres", data_fetcher);
    const ilyana_animation_fres = await get_animations_from_apak("TokyoMirageSessionsSharpFE/nonplayer/np122/skin/01/model_common.apak", data_fetcher);

    // for (let i = 0; i < ilyana_animation_fres.length; i++)
    // {
    //     console.log(`${i} ${ilyana_animation_fres[i].fska[0].name}`);
    // }

    gimmicks.push
    (
        new gimmick
        (
            vec3.fromValues(50.0, 0.0, 20.0),
            vec3.fromValues(0.0, -0.8, 0.0), // TODO: this is incorrect
            vec3.fromValues(1.0, 1.0, 1.0),
            ilyana_model_fres,
            device,
            new GfxRenderHelper(device),
            ilyana_animation_fres[34], // idle
        )
    );

    return gimmicks;
}