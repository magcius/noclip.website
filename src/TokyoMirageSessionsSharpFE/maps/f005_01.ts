// f005_01.ts
// Daiba Studio

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_f005_01_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const monitors: number[] = [1500, 1501, 1502, 1503];
    const notepcs: number[] = [1520, 1521, 1522];
    const desks: number[] = [1530, 1533, 1534, 1535, 1536, 1537];
    const spotlights: number[] = [1540, 1541, 1544, 1545, 1546];

    for (let i = 0; i < monitors.length; i++)
    {
        const point = get_layout_point(layout, monitors[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                point.position,
                point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/prop/monitor/skin/00/model.apak",
                "monitor_00.bfres",
                data_fetcher,
                device
            )
        );
    }

    const hdcamera_point = get_layout_point(layout, 1514, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            hdcamera_point.position,
            hdcamera_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/hdcamera/skin/00/model.apak",
            "hdcamera_00.bfres",
            data_fetcher,
            device
        )
    );

    for (let i = 0; i < notepcs.length; i++)
    {
        const point = get_layout_point(layout, notepcs[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                point.position,
                point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/prop/notepc01/skin/00/model.apak",
                "notepc01_00.bfres",
                data_fetcher,
                device
            )
        );
    }

    for (let i = 0; i < desks.length; i++)
    {
        const point = get_layout_point(layout, desks[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                point.position,
                point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/prop/desk01/skin/00/model.apak",
                "desk01_00.bfres",
                data_fetcher,
                device
            )
        );
    }

    for (let i = 0; i < spotlights.length; i++)
    {
        const point = get_layout_point(layout, spotlights[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                point.position,
                point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/prop/spotlight/skin/00/model.apak",
                "spotlight_00.bfres",
                data_fetcher,
                device
            )
        );
    }

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/stepladder01/skin/00/model.apak",
            "stepladder01_00.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}

export async function create_f005_01_music_fes_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(0.0, 0.0, 0.0),
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/prop/largeprops03/skin/00/model.apak",
            "largeprops03_00.bfres",
            data_fetcher,
            device
        )
    );
    
    return gimmicks;
}
