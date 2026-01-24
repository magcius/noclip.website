// gimmick.ts
// represents a dynamic or interactable object in levels, such as treasure boxes or warp pads

import { parseAPAK, get_file_by_name, get_fres_from_apak } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers";
import { DataFetcher } from "../DataFetcher.js";
import { FSKA } from "./bfres/fska.js";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { vec3 } from "gl-matrix";
import { MapLayout, get_point_from_group } from "./maplayout.js";
import { fmdl_renderer } from "./render_fmdl.js";
import { assert } from "../util.js";

export class gimmick
{
    public fmdl_renderer: fmdl_renderer;

    /**
     * @param rotation euler XYZ rotation in radians
     */
    constructor (position: vec3, rotation: vec3, scale: vec3, model_fres: FRES, device: GfxDevice, renderHelper: GfxRenderHelper, animation_fres?: FRES)
    {
        //initialize textures
        const bntx = BNTX.parse(model_fres.embedded_files[0].buffer);
        const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

        const fmdl = model_fres.fmdl[0];

        let fska: FSKA | null = null;
        if (animation_fres != undefined && animation_fres.fska.length > 0)
        {
                fska = animation_fres.fska[0];
        }

        this.fmdl_renderer = new fmdl_renderer
        (
            fmdl,
            bntx,
            gfx_texture_array,
            fska, 
            position,
            rotation,
            scale,
            false,
            device,
            renderHelper,
        );
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
    const apak = parseAPAK(await data_fetcher.fetchData(apak_path));
    const bfres = get_file_by_name(apak, bfres_name);
    if (bfres == undefined)
    {
        console.error(`file ${bfres_name} not found`);
        throw("whoops");
    }
    else
    {
        const fres = parseBFRES(bfres);
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
}

/**
 * These gimmicks are used in every dungeon, and are spawned by the executable instead of a lua script
 * they each have a unique group index in the map layout file
 * @param layout the map layout object for the current level
 * @param gate_type it's currently unknown how the game chooses which gate model to use. currently just hard coding it
 * @param is_d018_03 this map has some hardcoded behavior, and using a bool is faster than a string compare
 * @returns an array of all the gimmick objects spawned
 */
export async function create_common_gimmicks(layout: MapLayout, gate_type:number, is_d018_03: boolean, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    let gimmicks: gimmick[] = [];

    // yellow treasure boxes
    const treasure_box_01_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model.apak", "treasurebox_01.bfres", data_fetcher);
    const treasurebox_01_animation_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model_common.apak", "fd_idle_00.anm", data_fetcher);

    for (let i = 0; i < layout.treasurebox_01_entries.length; i++)
    {
        const entry = layout.treasurebox_01_entries[i];
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
            )
        );
    }

    // blue treasure boxes in Illusory Area of Aspirations
    const treasure_box_02_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/02/model.apak", "treasurebox_02.bfres", data_fetcher);

    for (let i = 0; i < layout.treasurebox_02_entries.length; i++)
    {
        const entry = layout.treasurebox_02_entries[i];
        let scale = vec3.fromValues(1.0, 1.0, 1.0);
        // scale up the special chests at the end of each room
        if (entry.id == 1130 || entry.id == 1230 || entry.id == 1430)
        {  
            scale = vec3.fromValues(D018_TREASURE_BOX_SCALE, D018_TREASURE_BOX_SCALE, D018_TREASURE_BOX_SCALE);
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
            )
        );
    }

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

    // heal points
    // TODO: these are particle effects, which aren't implemented yet
    // if (layout.heal_point_entries.length > 0)
    // {
    //     for (let i = 0; i < layout.heal_point_entries.length; i++)
    //     {
    //         const entry = layout.heal_point_entries[i];

    //     }
    // }
    
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

    // GIMMICK_GATE_L = "common/gate/skin/01"
    // GIMMICK_GATE_M = "common/gate/skin/02"
    // GIMMICK_GATE_F004 = "common/gate/skin/05" this model is offset slightly forward so that a wall in daitou TV doesn't clip through
    // GIMMICK_GATE_BLOOM = "common/gate/skin/06"
    // GIMMICK_GATE_DLC = "common/gate/skin/07"

    let gate_fres: FRES;
    switch(gate_type)
    {
        case 1:
            gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/01/model.apak", "gate_01.bfres", data_fetcher);
            break;

        case 2:
            gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/02/model.apak", "gate_02.bfres", data_fetcher);
            break;

        case 5:
            gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/05/model.apak", "gate_05.bfres", data_fetcher);
            break;

        case 6:
            gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/06/model.apak", "gate_06.bfres", data_fetcher);
            break;

        case 7:
            gate_fres = await get_fres_from_apak("TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/07/model.apak", "gate_07.bfres", data_fetcher);
            break;
    
        default:
            console.error(`invalid gate type ${gate_type}`);
            throw("whoops");
    }

    for (let i = 0; i < layout.gate_entries.length; i++)
    {
        const entry = layout.gate_entries[i];
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
            )
        );
    }

    return gimmicks;
}

const WALL_HEIGHT_OFFSET = 30.0;
const GATE_HEIGHT_OFFSET = 20.0;
// TODO: not 100% sure these are right
const D018_TREASURE_BOX_SCALE = 2.0;
const D018_003_WALL_HEIGHT_OFFSET = 20.0;
const D018_003_WALL_SCALE = 0.75;

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
