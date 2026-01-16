// d_003_01.ts
// Illusory 106 5F to 7F

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d003_02_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const swA1_POINT_MANNEQUIN = 1510;
    const swA2_POINT_MANNEQUIN = 1511;
    const swA3_POINT_MANNEQUIN = 1512;
    const swA_POINT_MANNEQUIN_BIG = 1550;
    const swB1_POINT_MANNEQUIN = 1610;
    const swB2_POINT_MANNEQUIN = 1611;
    const swB_POINT_MANNEQUIN_BIG = 1650;

    const swA1_mannequin_point = get_layout_point(layout, swA1_POINT_MANNEQUIN, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA1_mannequin_point.position,
            swA1_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/18/model.apak",
            "mannequin_18.bfres",
            data_fetcher,
            device
        )
    );

    const swA1_mannequin_point2 = get_layout_point(layout, swA1_POINT_MANNEQUIN, 14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA1_mannequin_point2.position,
            swA1_mannequin_point2.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/20/model.apak",
            "mannequin_20.bfres",
            data_fetcher,
            device
        )
    );

    const swA1_mannequin_point3 = get_layout_point(layout, swA1_POINT_MANNEQUIN, -14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA1_mannequin_point3.position,
            swA1_mannequin_point3.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/21/model.apak",
            "mannequin_21.bfres",
            data_fetcher,
            device
        )
    );

    const swA2_mannequin_point = get_layout_point(layout, swA2_POINT_MANNEQUIN, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA2_mannequin_point.position,
            swA2_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/16/model.apak",
            "mannequin_16.bfres",
            data_fetcher,
            device
        )
    );

    const swA2_mannequin_point2 = get_layout_point(layout, swA2_POINT_MANNEQUIN, 14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA2_mannequin_point2.position,
            swA2_mannequin_point2.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/28/model.apak",
            "mannequin_28.bfres",
            data_fetcher,
            device
        )
    );

    const swA2_mannequin_point3 = get_layout_point(layout, swA2_POINT_MANNEQUIN, -14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA2_mannequin_point3.position,
            swA2_mannequin_point3.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/18/model.apak",
            "mannequin_18.bfres",
            data_fetcher,
            device
        )
    );

    const swB1_mannequin_point = get_layout_point(layout, swB1_POINT_MANNEQUIN, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB1_mannequin_point.position,
            swB1_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/25/model.apak",
            "mannequin_25.bfres",
            data_fetcher,
            device
        )
    );
    
    const swB1_mannequin_point2 = get_layout_point(layout, swB1_POINT_MANNEQUIN, 14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB1_mannequin_point2.position,
            swB1_mannequin_point2.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/27/model.apak",
            "mannequin_27.bfres",
            data_fetcher,
            device
        )
    );
    
    const swB1_mannequin_point3 = get_layout_point(layout, swB1_POINT_MANNEQUIN, -14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB1_mannequin_point3.position,
            swB1_mannequin_point3.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/24/model.apak",
            "mannequin_24.bfres",
            data_fetcher,
            device
        )
    );
    
    const swB2_mannequin_point = get_layout_point(layout, swB2_POINT_MANNEQUIN, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB2_mannequin_point.position,
            swB2_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/24/model.apak",
            "mannequin_24.bfres",
            data_fetcher,
            device
        )
    );
    
    const swB2_mannequin_point2 = get_layout_point(layout, swB2_POINT_MANNEQUIN, 14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB2_mannequin_point2.position,
            swB2_mannequin_point2.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/22/model.apak",
            "mannequin_22.bfres",
            data_fetcher,
            device
        )
    );
    
    const swB2_mannequin_point3 = get_layout_point(layout, swB2_POINT_MANNEQUIN, -14.9, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB2_mannequin_point3.position,
            swB2_mannequin_point3.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/23/model.apak",
            "mannequin_23.bfres",
            data_fetcher,
            device
        )
    );
        
    const swA_mannequinbig_point = get_layout_point(layout, swA_POINT_MANNEQUIN_BIG, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swA_mannequinbig_point.position,
            swA_mannequinbig_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequinbig/skin/03/model.apak",
            "mannequinbig_03.bfres",
            data_fetcher,
            device
        )
    );

    const swB_mannequinbig_point = get_layout_point(layout, swB_POINT_MANNEQUIN_BIG, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            swB_mannequinbig_point.position,
            swB_mannequinbig_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequinbig/skin/04/model.apak",
            "mannequinbig_04.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
