// f003_02.ts
// Fortuna Office

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
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

export async function create_party_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
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

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const f003_02_textures: replacement_texture[] = [];
    f003_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex079.gtx", "notice15", data_fetcher, device));
    f003_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex084.gtx", "notice16", data_fetcher, device));
    f003_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex130.gtx", "notice21", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f003_02", replacement_textures: f003_02_textures });

    const obj10_textures = await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/tv_tex024.gtx", "obj10_tv", data_fetcher, device);
    replacement_texture_groups.push({ model_name: "obj10", replacement_textures: [obj10_textures] });

    const obj11_textures = await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/tv_tex001.gtx", "obj11_tv", data_fetcher, device);
    replacement_texture_groups.push({ model_name: "obj11", replacement_textures: [obj11_textures] });

    return replacement_texture_groups;
}
