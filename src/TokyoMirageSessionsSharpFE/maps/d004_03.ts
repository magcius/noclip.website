// d004_03.ts
// Illusory Shibuya Block 3

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "../maplayout.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const CameraFloorRed: number[] = [1600, 1601, 1602, 1603];
    const CameraFloorBlue: number[] = [1650, 1651];
    const FloorButtonRed = 1610;
    const FloorButtonBlue = 1660;
    const RtPointArea03G = 1503;

    for (let i = 0; i < CameraFloorRed.length; i++)
    {
        const camera_floor_red_point = get_layout_point(layout, CameraFloorRed[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                camera_floor_red_point.position,
                camera_floor_red_point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/Character/gimmick/d004/photofloor/skin/01/model",
                "photofloor_01.bfres",
                data_fetcher,
                device
            )
        );
    }

    for (let i = 0; i < CameraFloorBlue.length; i++)
    {
        const camera_floor_blue_point = get_layout_point(layout, CameraFloorBlue[i], 0.0, 0.0, 0.0);
        gimmicks.push
        (
            await create_gimmick
            (
                camera_floor_blue_point.position,
                camera_floor_blue_point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/Character/gimmick/d004/photofloor/skin/02/model",
                "photofloor_02.bfres",
                data_fetcher,
                device
            )
        );
    }

    const fallen_pictures_green_point = get_layout_point(layout, RtPointArea03G, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            fallen_pictures_green_point.position,
            fallen_pictures_green_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d004/fallenpictures/skin/03/model",
            "fallenpictures_03.bfres",
            data_fetcher,
            device
        )
    );

    const floor_button_red = get_layout_point(layout, FloorButtonRed, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            floor_button_red.position,
            floor_button_red.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d004/switch_red/skin/01/model",
            "switch_red_01.bfres",
            data_fetcher,
            device
        )
    );

    const floor_button_blue = get_layout_point(layout, FloorButtonBlue, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            floor_button_blue.position,
            floor_button_blue.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d004/switch_blue/skin/01/model",
            "switch_blue_01.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
