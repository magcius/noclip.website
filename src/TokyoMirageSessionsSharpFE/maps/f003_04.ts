// f003_04.ts
// Jewelry Carabia

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_actor } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "../maplayout.js";
import * as MathHelpers from "../../MathHelpers.js";

export async function create_f003_04_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const aimee_position = vec3.fromValues(0.0, 2.8, 97);
    const aimee_yaw = 180.0 * MathHelpers.MathConstants.DEG_TO_RAD;
    
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np121/skin/01", "np121_01.bfres", "fd_idle_00.anm", aimee_position, aimee_yaw, data_fetcher, device)
    );

    return gimmicks;
}
