// f010_07.ts 
// Tokyo Millennium Collection Venue

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "../maplayout.js";

export async function create_gimmicks(data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/nonplayer/np504/skin/22/model",
            "np504_22.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
