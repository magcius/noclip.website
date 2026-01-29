// f003_08.ts
// Anzu

import { get_file_by_name, get_fres_from_apak, parseAPAK } from "../apak.js";
import { parseBFRES } from "../bfres/bfres_switch.js";
import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "./../maplayout.js";

export async function create_f003_08_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/anzucar/skin/00/model.apak",
            "anzucar_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzucat/skin/00/model.apak",
            "anzucat_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzurabbit/skin/00/model.apak",
            "anzurabbit_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzuhorse/skin/00/model.apak",
            "anzuhorse_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzubear/skin/00/model.apak",
            "anzubear_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzulion/skin/00/model.apak",
            "anzulion_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzuleftclothshelf/skin/00/model.apak",
            "anzuleftclothshelf_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/anzurightclothshelf/skin/00/model.apak",
            "anzurightclothshelf_00.bfres",
            data_fetcher,
            device
        )
    );

    const cath_model_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/nonplayer/np123/skin/01/model.apak", "np123_01.bfres", data_fetcher);
    const cath_animation_apak_data = await data_fetcher.fetchData("TokyoMirageSessionsSharpFE/nonplayer/np123/skin/01/model_common.apak");
    const cath_animation_apak = parseAPAK(cath_animation_apak_data);
    const cath_animation_bfres = get_file_by_name(cath_animation_apak, "fd_idle_00.anm");
    let cath_animation_fres;
    if (cath_animation_bfres != undefined)
    {
        cath_animation_fres = parseBFRES(cath_animation_bfres);
    }
    
    gimmicks.push
    (
        new gimmick
        (
            vec3.fromValues(2.4, 0.0, -63.5),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            cath_model_fres,
            device,
            new GfxRenderHelper(device),
            cath_animation_fres,
        )
    );

    return gimmicks;
}
