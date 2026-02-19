// f003_06.ts
// Café Seiren (Dead)

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_actor } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "../maplayout.js";

export async function create_f003_10_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const ilyana_position = vec3.fromValues(40.7, 0.0, 13.8);
    const player_position = vec3.fromValues(41.49, 0.0, 23.54);
    const ilyana_yaw = Math.atan2(player_position[0] - ilyana_position[0], player_position[2] - ilyana_position[2])
    
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np122/skin/01", "np122_01.bfres", "fd_idlebad_00.anm", ilyana_position, ilyana_yaw, data_fetcher, device)
    );

    return gimmicks;

}
