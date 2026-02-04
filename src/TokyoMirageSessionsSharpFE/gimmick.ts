// gimmick.ts
// represents a dynamic or interactable object in levels, such as treasure boxes or warp pads

import { get_fres_from_apak } from "./apak.js";
import { FRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers";
import { DataFetcher } from "../DataFetcher.js";
import { FMAA } from './bfres/fmaa.js';
import { FSKA } from "./bfres/fska.js";
import { AABB } from "../Geometry.js";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { vec3 } from "gl-matrix";
import { MapLayout, get_point_from_group } from "./maplayout.js";
import { fmdl_renderer } from "./render_fmdl.js";

export class gimmick
{
    public fmdl_renderer: fmdl_renderer;

    /**
     * @param rotation euler XYZ rotation in radians
     */
    constructor (position: vec3, rotation: vec3, scale: vec3, model_fres: FRES, device: GfxDevice, renderHelper: GfxRenderHelper, animation_fres?: FRES, override_bounding_box?: AABB)
    {
        // initialize textures
        const bntx = BNTX.parse(model_fres.embedded_files[0].buffer);
        const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

        const fmdl = model_fres.fmdl[0];

        // get animations
        let fska: FSKA | undefined = undefined;
        let fmaa: FMAA | undefined = undefined;
        if (animation_fres != undefined)
        {
            if (animation_fres.fska.length > 0)
            {
                fska = animation_fres.fska[0];
            }
            if (animation_fres.fmaa.length > 0)
            {
                fmaa = animation_fres.fmaa[0];
            }
        }

        this.fmdl_renderer = new fmdl_renderer
        (
            fmdl,
            bntx,
            gfx_texture_array,
            fska,
            fmaa,
            position,
            rotation,
            scale,
            false,
            device,
            renderHelper,
            override_bounding_box,
        );
    }

    public destroy(device: GfxDevice): void
    {
        this.fmdl_renderer.destroy(device);
    }
}

export async function create_gimmick
(
    position: vec3,
    rotation: vec3,
    scale: vec3,
    apak_path: string,
    bfres_name: string,
    data_fetcher: DataFetcher,
    device: GfxDevice
): Promise<gimmick>
{
    const fres = await get_fres_from_apak(apak_path, bfres_name, data_fetcher);
    const new_gimmick = new gimmick
    (
        position,
        rotation,
        scale,
        fres,
        device,
        new GfxRenderHelper(device),
        undefined,
    );
    return new_gimmick;
}

/**
 * These gimmicks are used in every dungeon, and are spawned by the executable instead of a lua script
 * they each have a unique group index in the map layout file
 * @param layout the map layout object for the current level
 * @param is_d018_03 this map has some hardcoded behavior, and using a bool is faster than a string compare
 * @returns an array of all the gimmick objects spawned
 */
export async function create_common_gimmicks(layout: MapLayout, is_d018_03: boolean, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    let gimmicks: gimmick[] = [];

    if (layout.treasurebox_01_entries.length > 0 || layout.treasurebox_02_entries.length > 0)
    {
        const treasurebox_01_animation_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model_common.apak", "fd_idle_00.anm", data_fetcher);

        // yellow treasure boxes
        if (layout.treasurebox_01_entries.length > 0)
        {
            const treasure_box_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model.apak", "treasurebox_01.bfres", data_fetcher);

            for (let i = 0; i < layout.treasurebox_01_entries.length; i++)
            {
                const entry = layout.treasurebox_01_entries[i];
                let bounding_box = new AABB();
                const bb_center = vec3.fromValues(entry.position[0], entry.position[1] + TREASURE_BOX_BB_HEIGHT_OFFSET, entry.position[2]);
                const bb_extents = vec3.fromValues(TREASURE_BOX_BB_WIDTH, TREASURE_BOX_BB_HEIGHT, TREASURE_BOX_BB_WIDTH);
                bounding_box.setFromCenterAndHalfExtents(bb_center, bb_extents);
                gimmicks.push
                (
                    new gimmick
                    (
                        entry.position,
                        entry.rotation,
                        vec3.fromValues(1.0, 1.0, 1.0),
                        treasure_box_01_fres,
                        device,
                        new GfxRenderHelper(device),
                        treasurebox_01_animation_fres,
                        bounding_box,
                    )
                );
            }
        }

        // blue treasure boxes in Illusory Area of Aspirations
        if (layout.treasurebox_02_entries.length > 0)
        {
            const treasure_box_02_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/02/model.apak", "treasurebox_02.bfres", data_fetcher);

            for (let i = 0; i < layout.treasurebox_02_entries.length; i++)
            {
                const entry = layout.treasurebox_02_entries[i];
                let scale = vec3.fromValues(1.0, 1.0, 1.0);
                let bounding_box = new AABB();

                if (entry.id == 1130 || entry.id == 1230 || entry.id == 1430)
                {  
                    // scale up the special chests at the end of each room
                    scale = vec3.fromValues(D018_TREASURE_BOX_SCALE, D018_TREASURE_BOX_SCALE, D018_TREASURE_BOX_SCALE);

                    const bb_center = vec3.fromValues(entry.position[0], entry.position[1] + TREASURE_BOX_BB_HEIGHT_OFFSET * D018_TREASURE_BOX_SCALE, entry.position[2]);
                    const large_treasure_box_bb_extents = vec3.create();
                    vec3.scale(large_treasure_box_bb_extents, vec3.fromValues(TREASURE_BOX_BB_WIDTH, TREASURE_BOX_BB_HEIGHT, TREASURE_BOX_BB_WIDTH), D018_TREASURE_BOX_SCALE)
                    bounding_box.setFromCenterAndHalfExtents(bb_center, large_treasure_box_bb_extents);
                }
                else
                {
                    const bb_center = vec3.fromValues(entry.position[0], entry.position[1] + TREASURE_BOX_BB_HEIGHT_OFFSET, entry.position[2]);
                    const bb_extents = vec3.fromValues(TREASURE_BOX_BB_WIDTH, TREASURE_BOX_BB_HEIGHT, TREASURE_BOX_BB_WIDTH);
                    bounding_box.setFromCenterAndHalfExtents(bb_center, bb_extents);
                }
                
                gimmicks.push
                (
                    new gimmick
                    (
                        entry.position,
                        entry.rotation,
                        scale,
                        treasure_box_02_fres,
                        device,
                        new GfxRenderHelper(device),
                        treasurebox_01_animation_fres,
                        bounding_box,
                    )
                );
            }
        }
    }

    if (layout.blockside_entries.length > 0)
    {
        const blockside_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/blockside/skin/01/model.apak", "blockside_01.bfres", data_fetcher);

        for (let i = 0; i < layout.blockside_entries.length; i++)
        {
            const entry = layout.blockside_entries[i];
            let scale = vec3.fromValues(1.0, 1.0, 1.0);
            let y_position = entry.position[1] - WALL_HEIGHT_OFFSET;
            // this map has the blockside walls scaled down
            if (is_d018_03)
            {
                scale = vec3.fromValues(D018_003_WALL_SCALE, D018_003_WALL_SCALE, D018_003_WALL_SCALE);
                y_position = entry.position[1] - D018_003_WALL_HEIGHT_OFFSET;
            }
            gimmicks.push
            (
                new gimmick
                (
                    vec3.fromValues(entry.position[0], y_position, entry.position[2]),
                    entry.rotation,
                    scale,
                    blockside_01_fres,
                    device,
                    new GfxRenderHelper(device),
                )
            );
        }
    }

    if (layout.blockwall_entries.length > 0)
    {
        const blockwall_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/blockwall/skin/01/model.apak", "blockwall_01.bfres", data_fetcher);

        for (let i = 0; i < layout.blockwall_entries.length; i++)
        {
            const entry = layout.blockwall_entries[i];
            gimmicks.push
            (
                new gimmick
                (
                    vec3.fromValues(entry.position[0], entry.position[1] - WALL_HEIGHT_OFFSET, entry.position[2]),
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    blockwall_01_fres,
                    device,
                    new GfxRenderHelper(device),
                )
            );
        }
    }

    // heal points
    // TODO: these are particle effects, which aren't implemented yet
    // if (layout.heal_point_entries.length > 0)
    // {
    //     for (let i = 0; i < layout.heal_point_entries.length; i++)
    //     {
    //         const entry = layout.heal_point_entries[i];

    //     }
    // }
    if (layout.warp_entries.length > 0)
    {
        const warp_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/warp/skin/01/model.apak", "warp_01.bfres", data_fetcher);

        for (let i = 0; i < layout.warp_entries.length; i++)
        {
            const entry = layout.warp_entries[i];
            gimmicks.push
            (
                new gimmick
                (
                    entry.position,
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    warp_01_fres,
                    device,
                    new GfxRenderHelper(device),
                )
            );
        }
    }

    if (layout.gate_entries.length > 0)
    {
        const gate_animation_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/01/model_common.apak", "fd_idle_00.anm", data_fetcher);

        for (let i = 0; i < layout.gate_entries.length; i++)
        {
            const entry = layout.gate_entries[i];
            let gate_fres: FRES;
            const gate_type = entry.unk_8C;
            switch(gate_type)
            {
                case "":
                case "1":
                    // GIMMICK_GATE_L
                    gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/01/model.apak", "gate_01.bfres", data_fetcher);
                    break;

                case "2":
                    // GIMMICK_GATE_M
                    gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/02/model.apak", "gate_02.bfres", data_fetcher);
                    break;

                case "5":
                    // GIMMICK_GATE_F004 slightly forward version of GIMMICK_GATE_L to avoid clipping in Daitou TV
                    gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/05/model.apak", "gate_05.bfres", data_fetcher);
                    break;

                case "6":
                    // GIMMICK_GATE_BLOOM
                    gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/06/model.apak", "gate_06.bfres", data_fetcher);
                    break;

                case "7":
                    // GIMMICK_GATE_DLC
                    gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/07/model.apak", "gate_07.bfres", data_fetcher);
                    break;
            
                default:
                    console.error(`invalid gate type ${gate_type}`);
                    throw("whoops");
            }
            gimmicks.push
            (
                new gimmick
                (
                    vec3.fromValues(entry.position[0], entry.position[1] - GATE_HEIGHT_OFFSET, entry.position[2]),
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    gate_fres,
                    device,
                    new GfxRenderHelper(device),
                    gate_animation_fres,
                )
            );
        }
    }

    return gimmicks;
}

// TODO: not 100% sure these are right
const D018_TREASURE_BOX_SCALE = 2.0;
const D018_003_WALL_HEIGHT_OFFSET = 20.0;
const D018_003_WALL_SCALE = 0.75;

const TREASURE_BOX_BB_HEIGHT_OFFSET = 10.0;
const TREASURE_BOX_BB_WIDTH = 9.0;
const TREASURE_BOX_BB_HEIGHT = 5.0;
const WALL_HEIGHT_OFFSET = 30.0;
const GATE_HEIGHT_OFFSET = 20.0;

/**
 * port of gimCreateElevator() from lua scripts.
 * @param layout the map layout object for the current level
 * @param layout_id1 layout id for the elevator start position
 * @param layout_id2 layout id for the elevator end position
 * @returns an elevator gimmick
 */
export async function create_elevator
(
    layout: MapLayout,
    layout_id1: number,
    layout_id2: number,
    data_fetcher: DataFetcher,
    device: GfxDevice
): Promise<gimmick>
{
    const point = get_point_from_group(layout.elevator_entries, layout_id1);
    const position = vec3.fromValues(point.position[0], point.position[1] - ELEVATOR_HEIGHT_OFFSET, point.position[2]);
    return await create_gimmick
    (
        position,
        point.rotation,
        vec3.fromValues(1.0, 1.0, 1.0),
        "TokyoMirageSessionsSharpFE/gimmick/d002/elevator/skin/01/model.apak",
        "elevator_01.bfres",
        data_fetcher,
        device
    )
}

const ELEVATOR_HEIGHT_OFFSET = 5.0;

/**
 * port of gimSetTransFloorFirst() from lua scripts
 * @param layout the map layout object for the current level
 * @param layout_id layout id for the transparent floor start position
 * @returns a transparent floor gimmick
 */
export async function create_transparent_floor_first
(
    layout: MapLayout,
    layout_id: number,
    data_fetcher: DataFetcher,
    device: GfxDevice
): Promise<gimmick>
{
    const point = get_point_from_group(layout.transparent_floor_entries, layout_id);
    const position = vec3.fromValues(point.position[0], point.position[1] - TRANSPARENT_FLOOR_HEIGHT_OFFSET, point.position[2]);
    const scale = vec3.fromValues(TRANSPARENT_FLOOR_SCALE, TRANSPARENT_FLOOR_SCALE, TRANSPARENT_FLOOR_SCALE);
    return await create_gimmick
    (
        position,
        point.rotation,
        scale,
        "TokyoMirageSessionsSharpFE/gimmick/d007/transparentfloor/skin/01/model.apak",
        "transparentfloor_01.bfres",
        data_fetcher,
        device
    );
}

const TRANSPARENT_FLOOR_SCALE = 1.25;
const TRANSPARENT_FLOOR_HEIGHT_OFFSET = 13.75;
