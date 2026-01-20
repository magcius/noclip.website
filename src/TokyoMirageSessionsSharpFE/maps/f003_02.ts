// f003_02.ts
// Fortuna Office

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_f003_02_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const notepc_point = get_layout_point(layout, 889, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            notepc_point.position,
            notepc_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/notepc01/skin/00/model.apak",
            "notepc01_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function create_f003_02_party_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const notepc_point = get_layout_point(layout, 889, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            notepc_point.position,
            notepc_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/notepc01/skin/00/model.apak",
            "notepc01_00.bfres",
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
            "TokyoMirageSessionsSharpFE/prop/partyset/skin/00/model.apak",
            "partyset_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
