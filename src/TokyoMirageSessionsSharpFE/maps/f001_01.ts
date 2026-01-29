// f001_01.ts
// Shibuya

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function f001_01_replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const notice_textures: replacement_texture[] = [];
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/notice_tex003.gtx", "notice00", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f001_01", replacement_textures: notice_textures });
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex010.gtx", "notice01", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f001_01", replacement_textures: notice_textures });
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex023.gtx", "notice02", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f001_01", replacement_textures: notice_textures });
    notice_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex046.gtx", "notice04", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f001_01", replacement_textures: notice_textures });

    const tv_textures: replacement_texture[] = [];
    tv_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Notice/tv_tex001.gtx", "obj10", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "obj10", replacement_textures: tv_textures });

    return replacement_texture_groups;
}
