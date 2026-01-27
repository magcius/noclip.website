// battle.ts
// all battle arenes

import { get_file_by_name, get_fres_from_apak, get_animations_from_apak } from "../apak.js";
import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";
import { gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";

export async function create_battle_gimmicks(data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const audience_00_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model.apak", "audience00_00.bfres", data_fetcher);
    const audience_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience01/skin/00/model.apak", "audience01_00.bfres", data_fetcher);
    const audience_02_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience02/skin/00/model.apak", "audience02_00.bfres", data_fetcher);
    const audience_00_animation_fres = await get_animations_from_apak("TokyoMirageSessionsSharpFE/Battle/Obj/audience00/skin/00/model_common.apak", data_fetcher);
    
    gimmicks.push
    (
        new gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            audience_00_fres,
            device,
            new GfxRenderHelper(device),
            audience_00_animation_fres[0],
        )
    );
    gimmicks.push
    (
        new gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            audience_01_fres,
            device,
            new GfxRenderHelper(device),
            audience_00_animation_fres[0],
        )
    );
    gimmicks.push
    (
        new gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            audience_02_fres,
            device,
            new GfxRenderHelper(device),
            audience_00_animation_fres[0],
        )
    );
    return gimmicks;
}
