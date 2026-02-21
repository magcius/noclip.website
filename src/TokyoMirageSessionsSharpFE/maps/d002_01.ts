// d_002_01.ts
// Illusory Daitama

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_elevator } from "../gimmick.js";
import { MapLayout } from "../maplayout.js";

export async function create_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    gimmicks.push(await create_elevator(layout, 1000, 1001, data_fetcher, device));
    gimmicks.push(await create_elevator(layout, 1002, 1003, data_fetcher, device));
    gimmicks.push(await create_elevator(layout, 1004, 1005, data_fetcher, device));
    
    return gimmicks;
}
