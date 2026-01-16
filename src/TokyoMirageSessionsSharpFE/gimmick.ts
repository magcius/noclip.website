// gimmick.ts
// represents a dynamic or interactable object in levels, such as treasure boxes or warp pads

import { parseAPAK, get_file_by_name } from "./apak.js";
import { FRES, parseBFRES } from "./bfres/bfres_switch.js";
import * as BNTX from '../fres_nx/bntx.js';
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers";
import { DataFetcher } from "../DataFetcher.js";
import { GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { vec3 } from "gl-matrix";
import { MapLayout, get_point_from_group } from "./maplayout.js";
import { fshp_renderer } from "./render_fshp";
import { assert } from "../util.js";

export class gimmick
{
    public fshp_renderers: fshp_renderer[] = [];

    // rotation: euler XYZ rotation in radians
    constructor (position: vec3, rotation: vec3, scale: vec3, fres: FRES, device: GfxDevice, renderHelper: GfxRenderHelper)
    {
        //initialize textures
        const bntx = BNTX.parse(fres.embedded_files[0].buffer);
        const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

        // create all fshp_renderers
        const fmdl = fres.fmdl[0];
        const shapes = fmdl.fshp;
        for (let i = 0; i < shapes.length; i++)
        {
            const renderer = new fshp_renderer(device, renderHelper, fmdl, i, bntx, gfx_texture_array, position, rotation, scale);
            this.fshp_renderers.push(renderer);
        }
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
    if (layout.treasurebox_01_entries.length > 0)
    {
        for (let i = 0; i < layout.treasurebox_01_entries.length; i++)
        {
            const entry = layout.treasurebox_01_entries[i];
            gimmicks.push
            (
                await create_gimmick
                (
                    entry.position,
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    "TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model.apak",
                    "treasurebox_01.bfres",
                    data_fetcher,
                    device
                )
            );
        }
    }

    // blue treasure boxes in Illusory Area of Aspirations
    if (layout.treasurebox_02_entries.length > 0)
    {
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
                await create_gimmick
                (
                    entry.position,
                    entry.rotation,
                    scale,
                    "TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/02/model.apak",
                    "treasurebox_02.bfres",
                    data_fetcher,
                    device
                )
            );
        }
    }

    if (layout.blockside_entries.length > 0)
    {
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
                await create_gimmick
                (
                    vec3.fromValues(entry.position[0], y_position, entry.position[2]),
                    entry.rotation,
                    scale,
                    "TokyoMirageSessionsSharpFE/gimmick/common/blockside/skin/01/model.apak",
                    "blockside_01.bfres",
                    data_fetcher,
                    device
                )
            );
        }
    }

    if (layout.blockwall_entries.length > 0)
    {
        for (let i = 0; i < layout.blockwall_entries.length; i++)
        {
            const entry = layout.blockwall_entries[i];
            gimmicks.push
            (
                await create_gimmick
                (
                    vec3.fromValues(entry.position[0], entry.position[1] - WALL_HEIGHT_OFFSET, entry.position[2]),
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    "TokyoMirageSessionsSharpFE/gimmick/common/blockwall/skin/01/model.apak",
                    "blockwall_01.bfres",
                    data_fetcher,
                    device
                )
            );
        }
    }

    if (layout.warp_entries.length > 0)
    {
        for (let i = 0; i < layout.warp_entries.length; i++)
        {
            const entry = layout.warp_entries[i];
            gimmicks.push
            (
                await create_gimmick
                (
                    entry.position,
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    "TokyoMirageSessionsSharpFE/gimmick/common/warp/skin/01/model.apak",
                    "warp_01.bfres",
                    data_fetcher,
                    device
                )
            );
        }
    }

    if (layout.gate_entries.length > 0)
    {
        let gate_types = [1, 2, 5, 6, 7];
        assert(gate_types.includes(gate_type));
        for (let i = 0; i < layout.gate_entries.length; i++)
        {
            const entry = layout.gate_entries[i];
            gimmicks.push
            (
                await create_gimmick
                (
                    vec3.fromValues(entry.position[0], entry.position[1] - GATE_HEIGHT_OFFSET, entry.position[2]),
                    entry.rotation,
                    vec3.fromValues(1.0, 1.0, 1.0),
                    `TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/0${gate_type}/model.apak`,
                    `gate_0${gate_type}.bfres`,
                    data_fetcher,
                    device
                )
            );
        }
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
