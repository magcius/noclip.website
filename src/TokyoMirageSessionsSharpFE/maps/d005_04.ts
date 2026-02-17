// d005_04.ts
// Illusory Daitou TV Film Set B: Indoors

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d005_04_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const QuestionWall03 = 1602;
    const QuestionWall04 = 1603;
    const QuestionWall05 = 1604;

    const condition_wall_3_point = get_layout_point(layout, QuestionWall03, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            condition_wall_3_point.position,
            condition_wall_3_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d005/conditionwall/skin/01/model",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );

    const condition_wall_4_point = get_layout_point(layout, QuestionWall04, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            condition_wall_4_point.position,
            condition_wall_4_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d005/conditionwall/skin/01/model",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );

    const condition_wall_5_point = get_layout_point(layout, QuestionWall05, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            condition_wall_5_point.position,
            condition_wall_5_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d005/conditionwall/skin/01/model",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );
    
    return gimmicks;
}
