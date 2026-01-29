// f003_06.ts
// Café Seiren

import { get_file_by_name, get_fres_from_apak, parseAPAK } from "../apak.js";
import { parseBFRES } from "../bfres/bfres_switch.js";
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
    const ilyana_animation_apak_data = await data_fetcher.fetchData("TokyoMirageSessionsSharpFE/nonplayer/np122/skin/01/model_common.apak");
    const ilyana_animation_apak = parseAPAK(ilyana_animation_apak_data);
    const ilyana_animation_bfres = get_file_by_name(ilyana_animation_apak, "fd_idle_00.anm");
    let ilyana_animation_fres;

    if (ilyana_animation_bfres != undefined)
    {
        ilyana_animation_fres = parseBFRES(ilyana_animation_bfres);
    }

    const ilyana_position = vec3.fromValues(50.0, 0.0, 20.0);
    const player_position = vec3.fromValues(41.49, 0.0, 23.54);
    const yaw_towards_player = Math.atan2(player_position[0] - ilyana_position[0], player_position[2] - ilyana_position[2])
    
    gimmicks.push
    (
        new gimmick
        (
            ilyana_position,
            vec3.fromValues(0.0, yaw_towards_player, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            ilyana_model_fres,
            device,
            new GfxRenderHelper(device),
            ilyana_animation_fres,
        )
    );

    return gimmicks;
}
