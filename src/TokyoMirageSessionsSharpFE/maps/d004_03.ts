// d004_03.ts
// Illusory Shibuya Block 3

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d004_03_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const CameraFloorRed1 = 1600;
    const CameraFloorRed2 = 1601;
    const CameraFloorRed3 = 1602;
    const CameraFloorRed4 = 1603;
    const CameraFloorBlue1 = 1650;
    const CameraFloorBlue2 = 1651;
    const FloorButtonRed = 1610;
    const FloorButtonBlue = 1660;
    const RtPointArea03G = 1503;

    const camera_floor_red_1_point = get_layout_point(layout, CameraFloorRed1, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_red_1_point.position,
            camera_floor_red_1_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/01/model.apak",
            "photofloor_01.bfres",
            data_fetcher,
            device
        )
    );

    const camera_floor_red_2_point = get_layout_point(layout, CameraFloorRed2, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_red_2_point.position,
            camera_floor_red_2_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/01/model.apak",
            "photofloor_01.bfres",
            data_fetcher,
            device
        )
    );

    const camera_floor_red_3_point = get_layout_point(layout, CameraFloorRed3, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_red_3_point.position,
            camera_floor_red_3_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/01/model.apak",
            "photofloor_01.bfres",
            data_fetcher,
            device
        )
    );

    const camera_floor_red_4_point = get_layout_point(layout, CameraFloorRed4, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_red_4_point.position,
            camera_floor_red_4_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/01/model.apak",
            "photofloor_01.bfres",
            data_fetcher,
            device
        )
    );

    const camera_floor_blue_1_point = get_layout_point(layout, CameraFloorBlue1, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_blue_1_point.position,
            camera_floor_blue_1_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/02/model.apak",
            "photofloor_02.bfres",
            data_fetcher,
            device
        )
    );

    const camera_floor_blue_2_point = get_layout_point(layout, CameraFloorBlue2, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            camera_floor_blue_2_point.position,
            camera_floor_blue_2_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/photofloor/skin/02/model.apak",
            "photofloor_02.bfres",
            data_fetcher,
            device
        )
    );

    const fallen_pictures_green_point = get_layout_point(layout, RtPointArea03G, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            fallen_pictures_green_point.position,
            fallen_pictures_green_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d004/fallenpictures/skin/03/model.apak",
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
            "TokyoMirageSessionsSharpFE/gimmick/d004/switch_red/skin/01/model.apak",
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
            "TokyoMirageSessionsSharpFE/gimmick/d004/switch_blue/skin/01/model.apak",
            "switch_blue_01.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
