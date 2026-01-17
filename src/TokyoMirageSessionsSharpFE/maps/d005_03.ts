// d005_03.ts
// Illusory Daitou TV Film Set A: Indoors

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d005_03_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const QuestionWall01 = 1600;
    const QuestionWall02 = 1601;

    const condition_wall_1_point = get_layout_point(layout, QuestionWall01, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            condition_wall_1_point.position,
            condition_wall_1_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d005/conditionwall/skin/01/model.apak",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );

    const condition_wall_2_point = get_layout_point(layout, QuestionWall02, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            condition_wall_2_point.position,
            condition_wall_2_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d005/conditionwall/skin/01/model.apak",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
