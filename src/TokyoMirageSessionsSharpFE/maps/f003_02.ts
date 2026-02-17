// f003_02.ts
// Fortuna Office

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function create_f003_02_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const notepc_point = get_layout_point(layout, 889, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            notepc_point.position,
            notepc_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/prop/notepc01/skin/00/model",
            "notepc01_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function create_f003_02_party_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const notepc_point = get_layout_point(layout, 889, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            notepc_point.position,
            notepc_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/prop/notepc01/skin/00/model",
            "notepc01_00.bfres",
            data_fetcher,
            device
        )
    );

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/prop/partyset/skin/00/model",
            "partyset_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function f003_02_replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const notice_textures: replacement_texture[] = [];
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/notice_tex094.gtx", "notice15", data_fetcher, device));
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/notice_tex100.gtx", "notice16", data_fetcher, device));
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex131.gtx", "notice21", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f003_02", replacement_textures: notice_textures });

    const tv_textures = await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/tv_tex024.gtx", "obj10_tv", data_fetcher, device);
    const tv_textures2 = await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/tv_tex001.gtx", "obj11_tv", data_fetcher, device);
    replacement_texture_groups.push({ model_name: "obj10", replacement_textures: [tv_textures] });
    replacement_texture_groups.push({ model_name: "obj11", replacement_textures: [tv_textures2] });

    return replacement_texture_groups;
}
