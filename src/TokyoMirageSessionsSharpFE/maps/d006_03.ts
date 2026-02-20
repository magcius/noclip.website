// d006_03.ts
// Illusory Daiba Studio LCD Panels

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { replacement_texture, replacement_texture_group, create_replacement_texture } from "../render_fmdl_texture_replace.js";

export async function replacement_textures(data_fetcher: DataFetcher, device: GfxDevice): Promise<replacement_texture_group[]>
{
    const replacement_texture_groups: replacement_texture_group[] = [];
    
    const panel_textures: replacement_texture[] = [];
    panel_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Gimmick/A01.gtx", "pnl01", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d006_03", replacement_textures: panel_textures });
    panel_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Gimmick/B01.gtx", "pnl02", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d006_03", replacement_textures: panel_textures });
    panel_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Gimmick/C01.gtx", "pnl03", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d006_03", replacement_textures: panel_textures });
    panel_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Gimmick/D01.gtx", "pnl04", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d006_03", replacement_textures: panel_textures });
    panel_textures.push(await create_replacement_texture("TokyoMirageSessionsSharpFE/Interface/_US/Gimmick/E01.gtx", "pnl05", data_fetcher, device));
    replacement_texture_groups.push({ model_name: "d006_03", replacement_textures: panel_textures });
    return replacement_texture_groups;
}
