// f007_01.ts
// Harajuku

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const f007_01_textures: replacement_texture[] = [];
    f007_01_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex090.gtx", "notice23", data_fetcher, device));
    f007_01_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex079.gtx", "notice24", data_fetcher, device));
    f007_01_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex101.gtx", "notice25", data_fetcher, device));
    f007_01_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Notice/notice_tex095.gtx", "notice26", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "f007_01", replacement_textures: f007_01_textures });

    return replacement_texture_groups;
}
