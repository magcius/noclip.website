// d005_02.ts
// Illusory Daitou TV Film Set B: Outdoors

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const d005_02_textures: replacement_texture[] = [];
    d005_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Gimmick/d005_01_kanban03.gtx", "e_phong72", data_fetcher, device));
    d005_02_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_JP/Gimmick/d005_01_kanban06.gtx", "phong83", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d005_02", replacement_textures: d005_02_textures });

    return replacement_texture_groups;
}
