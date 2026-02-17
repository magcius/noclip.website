// f002_03.ts
// Daitama Observatory

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_f002_03_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const heehawballoon_point = get_layout_point(layout, 1100, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            heehawballoon_point.position,
            heehawballoon_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/prop/heehawballoon/skin/00/model",
            "heehawballoon_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
