// d005_03.ts
// Illusory Daitou TV Film Set A: Indoors

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "../maplayout.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
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
            "TokyoMirageSessionsSharpFE/Character/gimmick/d005/conditionwall/skin/01/model",
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
            "TokyoMirageSessionsSharpFE/Character/gimmick/d005/conditionwall/skin/01/model",
            "conditionwall_01.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const d005_03_textures: replacement_texture[] = [];
    d005_03_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Gimmick/d005_03_kanban06.gtx", "pasted__pasted__phong83", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d005_03", replacement_textures: d005_03_textures });

    return replacement_texture_groups;
}
