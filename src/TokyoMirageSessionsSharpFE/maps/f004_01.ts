// f004_01.ts
// Daitou TV

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { MapLayout } from "./../maplayout.js";

export async function create_f004_01_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/largeprops01/skin/00/model.apak",
            "largeprops01_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function create_f004_01_music_fes_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/largeprops02/skin/00/model.apak",
            "largeprops02_00.bfres",
            data_fetcher,
            device
        )
    );
    
    return gimmicks;
}
