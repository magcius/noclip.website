// d007_04.ts
// Illusory Dolhr Altitude 428m to Altitude 434m

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_gimmick, create_transparent_floor_first } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_point_from_group, MapLayout } from "../maplayout.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const Elevator_toBehind = 1600;
    const Elevator_toAhead = 1601;
    const Floor_A: number[] = [1500, 1502, 1504, 1506];
    const transparent_floor_start: number[] = [1000, 1100, 1200, 1300, 1700];

    const elevator_to_behind_point = get_point_from_group(layout.event_entries, Elevator_toBehind);
    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(elevator_to_behind_point.position[0], elevator_to_behind_point.position[1] - 5.0, elevator_to_behind_point.position[2]),
            elevator_to_behind_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d007/elevator_nosphere/skin/01/model",
            "elevator_nosphere_01.bfres",
            data_fetcher,
            device
        )
    );

    const elevator_to_ahead_point = get_point_from_group(layout.event_entries, Elevator_toAhead);
    gimmicks.push
    (
        await create_gimmick
        (
            vec3.fromValues(elevator_to_ahead_point.position[0], elevator_to_ahead_point.position[1] - 5.0, elevator_to_ahead_point.position[2]),
            elevator_to_ahead_point.rotation,
            vec3.fromValues(1.0, 1.0, 1.0),
            "TokyoMirageSessionsSharpFE/Character/gimmick/d007/elevator_nosphere/skin/01/model",
            "elevator_nosphere_01.bfres",
            data_fetcher,
            device
        )
    );

    for (let i = 0; i < Floor_A.length; i++)
    {
        const movable_floor_point = get_point_from_group(layout.event_entries, Floor_A[i]);
        gimmicks.push
        (
            await create_gimmick
            (
                vec3.fromValues(movable_floor_point.position[0], movable_floor_point.position[1] - 5.0, movable_floor_point.position[2]),
                elevator_to_ahead_point.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                "TokyoMirageSessionsSharpFE/Character/gimmick/d007/movablefloor/skin/01/model",
                "movablefloor_01.bfres",
                data_fetcher,
                device
            )
        );
    }

    for (let i = 0; i < transparent_floor_start.length; i++)
    {
        gimmicks.push(await create_transparent_floor_first(layout, transparent_floor_start[i], data_fetcher, device));
    }

    return gimmicks;
}
