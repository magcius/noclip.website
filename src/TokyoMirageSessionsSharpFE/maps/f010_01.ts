// f010_01.ts
// Toubu Rooftop

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "../maplayout.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function create_music_fes_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/prop/largeprops05/skin/00/model",
            "largeprops05_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const f010_01_textures: replacement_texture[] = [];
    f010_01_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex090.gtx", "notice22", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f010_01", replacement_textures: f010_01_textures });

    return replacement_texture_groups;
}
