// d_003_03.ts
// Illusory 106 B1F to B3F

import { get_animations_from_apak, get_fres_from_apak } from "../apak.js";
import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick } from "./../gimmick.js";
import { vec3 } from "gl-matrix";
import { MannequinBig } from "../mannequinbig.js";
import { get_layout_point, MapLayout } from "./../maplayout.js";

export async function create_d003_03_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const mannequinbig_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/d003/mannequinbig/skin/01/model.apak",
                                                            "mannequinbig_01.bfres", data_fetcher);
    const mannequinbig_02_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/d003/mannequinbig/skin/02/model.apak",
                                                            "mannequinbig_02.bfres", data_fetcher);
    const mannequinbig_animations = await get_animations_from_apak("TokyoMirageSessionsSharpFE/gimmick/d003/mannequinbig/skin/01/model_common.apak", data_fetcher);

    const swA1_POINT_MANNEQUIN = 1510;
    const swA2_POINT_MANNEQUIN = 1511;
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/04/model.apak",
            "mannequin_04.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/01/model.apak",
            "mannequin_01.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/05/model.apak",
            "mannequin_05.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/02/model.apak",
            "mannequin_02.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/03/model.apak",
            "mannequin_03.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/04/model.apak",
            "mannequin_04.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/12/model.apak",
            "mannequin_12.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/10/model.apak",
            "mannequin_10.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/09/model.apak",
            "mannequin_09.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/07/model.apak",
            "mannequin_07.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/12/model.apak",
            "mannequin_12.bfres",
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
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/13/model.apak",
            "mannequin_13.bfres",
            data_fetcher,
            device
        )
    );

    const swA_mannequinbig_point = get_layout_point(layout, swA_POINT_MANNEQUIN_BIG, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        new MannequinBig(swA_mannequinbig_point, mannequinbig_01_fres, mannequinbig_animations, device)
    );

    const swB_mannequinbig_point = get_layout_point(layout, swB_POINT_MANNEQUIN_BIG, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        new MannequinBig(swB_mannequinbig_point, mannequinbig_02_fres, mannequinbig_animations, device)
    );

    const red_stand_mannequin_point = get_layout_point(layout, 1900, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            red_stand_mannequin_point.position,
            red_stand_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/09/model.apak",
            "mannequin_09.bfres",
            data_fetcher,
            device
        )
    );

    const blue_stand_mannequin_point = get_layout_point(layout, 1901, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            blue_stand_mannequin_point.position,
            blue_stand_mannequin_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequin/skin/05/model.apak",
            "mannequin_05.bfres",
            data_fetcher,
            device
        )
    );

    const blue_stand_point = get_layout_point(layout, 1101, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            blue_stand_point.position,
            blue_stand_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequinstand/skin/01/model.apak",
            "mannequinstand_01.bfres",
            data_fetcher,
            device
        )
    );

    const red_stand_point = get_layout_point(layout, 1100, 0.0, 0.0, 0.0);
    gimmicks.push
    (
        await create_gimmick
        (
            red_stand_point.position,
            red_stand_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/gimmick/d003/mannequinstand/skin/02/model.apak",
            "mannequinstand_02.bfres",
            data_fetcher,
            device
        )
    );

    return gimmicks;
}
