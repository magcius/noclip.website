// f003_08.ts
// Anzu

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_point_from_group, MapLayout } from "./../maplayout.js";

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
    
    return gimmicks;
}
