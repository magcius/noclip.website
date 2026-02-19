// f003_09.ts 
// Hee Ho Mart (Dead)

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_actor } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "../maplayout.js";
import * as MathHelpers from "../../MathHelpers.js";

export async function create_f003_09_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const anna_position = vec3.fromValues(-16.5, 0.0, -35.0);
    const anna_yaw = 90.0 * MathHelpers.MathConstants.DEG_TO_RAD;
    
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np100/skin/01", "np100_01.bfres", "fd_idlebad_00.anm", anna_position, anna_yaw, data_fetcher, device)
    );

    const masked_anna_position = vec3.fromValues(-16.5, 0.0, -72.5);

    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np100/skin/02", "np100_02.bfres", "fd_idle_00.anm", masked_anna_position, anna_yaw, data_fetcher, device)
    );

    return gimmicks;
}
