// f003_06.ts
// Café Seiren

import { DataFetcher } from "../../DataFetcher.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { gimmick, create_actor } from "../gimmick.js";
import { vec3 } from "gl-matrix";
import { get_point_from_group, MapLayout } from "../maplayout.js";

export async function create_f003_06_gimmicks(layout: MapLayout, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    const gimmicks: gimmick[] = [];

    const ilyana_position = vec3.fromValues(50.0, 0.0, 20.0);
    const player_position = vec3.fromValues(41.49, 0.0, 23.54);
    const ilyana_yaw = Math.atan2(player_position[0] - ilyana_position[0], player_position[2] - ilyana_position[2])
    
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np122/skin/01", "np122_01.bfres", "fd_idle_00.anm", ilyana_position, ilyana_yaw, data_fetcher, device)
    );

    // purple woman
    const mob1 = get_point_from_group(layout.npc_entries, 1500);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np502/skin/02", "np502_02.bfres", "fd_chair_01.anm", mob1.position, mob1.rotation[1], data_fetcher, device)
    );

    // yellow boy
    const mob2 = get_point_from_group(layout.npc_entries, 1501);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np501/skin/04", "np501_04.bfres", "fd_chair_01.anm", mob2.position, mob2.rotation[1], data_fetcher, device)
    );

    // blue woman
    const mob3 = get_point_from_group(layout.npc_entries, 1503);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np502/skin/00", "np502_00.bfres", "fd_chair_01.anm", mob3.position, mob3.rotation[1], data_fetcher, device)
    );

    // green boy
    const mob4 = get_point_from_group(layout.npc_entries, 1504);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np501/skin/01", "np501_01.bfres", "fd_chair_01.anm", mob4.position, mob4.rotation[1], data_fetcher, device)
    );

    // green man
    const mob5 = get_point_from_group(layout.npc_entries, 1505);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np500/skin/11", "np500_11.bfres", "fd_chair_01.anm", mob5.position, mob5.rotation[1], data_fetcher, device)
    );

    // green woman
    const mob6 = get_point_from_group(layout.npc_entries, 1506);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np502/skin/01", "np502_01.bfres", "fd_chair_01.anm", mob6.position, mob6.rotation[1], data_fetcher, device)
    );

    // blue man
    const mob7 = get_point_from_group(layout.npc_entries, 1507);
    gimmicks.push
    (
        await create_actor("TokyoMirageSessionsSharpFE/Character/nonplayer/np500/skin/10", "np500_10.bfres", "fd_chair_01.anm", mob7.position, mob7.rotation[1], data_fetcher, device)
    );

    return gimmicks;

}
