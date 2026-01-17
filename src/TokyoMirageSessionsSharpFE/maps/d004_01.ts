// d004_01.ts
// Illusory Shibuya Block 1

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d004_01_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const RtPointArea01R = 1501;

    const fallen_pictures_red_point = get_layout_point(layout, RtPointArea01R, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            fallen_pictures_red_point.position,
            fallen_pictures_red_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/fallenpictures/skin/01/model.apak",
            "fallenpictures_01.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
