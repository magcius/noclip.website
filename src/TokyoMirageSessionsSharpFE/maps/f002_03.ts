// f002_03.ts
// Daitama Observatory

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "../maplayout.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
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

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];

    const f002_03_textures: replacement_texture[] = [];
    f002_03_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Gimmick/f002_03_Booth00.gtx", "f002_03_Booth00", data_fetcher, device));
    f002_03_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex084.gtx", "notice17", data_fetcher, device));
    f002_03_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex079.gtx", "notice18", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f002_03", replacement_textures: f002_03_textures });
    
    const obj12_textures: replacement_texture[] = [];
    obj12_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/tv_tex008.gtx", "obj12", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "obj12", replacement_textures: obj12_textures });

    return replacement_texture_groups;
}
