// d006_02.ts
// Illusory Daiba Studio Main Hallway

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];

    // TODO: this texture isn't SRGB, i think it's causing the texture to look washed out
    // const d006_02_textures: replacement_texture[] = [];
    // d006_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Gimmick/d006_02_poster01.gtx", "phong37", data_fetcher, device));
    // replacement_texture_groups.push({ model_name: "d006_02", replacement_textures: d006_02_textures });
    
    return replacement_texture_groups;
}
