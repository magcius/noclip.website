// d004_02.ts
// Illusory Shibuya Block 2

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d004_02_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const RtPointArea02B = 1502;

    const fallen_pictures_blue_point = get_layout_point(layout, RtPointArea02B, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            fallen_pictures_blue_point.position,
            fallen_pictures_blue_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d004/fallenpictures/skin/02/model",
            "fallenpictures_02.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
