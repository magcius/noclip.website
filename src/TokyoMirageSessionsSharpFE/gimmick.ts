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
import { MapLayout } from "./maplayout.js";
import { fshp_renderer } from "./render_fshp";

export class gimmick
{
    public fshp_renderers: fshp_renderer[] = [];

    // rotation: euler XYZ rotation in degrees
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

export async function create_common_gimmicks(layout: MapLayout, level_id: string, data_fetcher: DataFetcher, device: GfxDevice): Promise<gimmick[]>
{
    let gimmicks: gimmick[] = [];

    // yellow treasure boxes
    if (layout.treasurebox_01_entries.length > 0)
    {
        const apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/01/model.apak`));
        const fres = parseBFRES(get_file_by_name(apak, "treasurebox_01.bfres"));
        
        for (let i = 0; i < layout.treasurebox_01_entries.length; i++)
        {
            const entry = layout.treasurebox_01_entries[i];
            const new_gimmick = new gimmick
            (
                entry.position,
                entry.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    // blue treasure boxes in Illusory Area of Aspirations
    if (layout.treasurebox_02_entries.length > 0)
    {
        const apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/treasurebox/skin/02/model.apak`));
        const fres = parseBFRES(get_file_by_name(apak, "treasurebox_02.bfres"))

        for (let i = 0; i < layout.treasurebox_02_entries.length; i++)
        {
            const entry = layout.treasurebox_02_entries[i];
            let scale = vec3.fromValues(1.0, 1.0, 1.0);
            // scale up the special chests at the end of each room
            if
            (
                entry.id == 1130 ||
                entry.id == 1230 ||
                entry.id == 1430
            )
            {
                // TODO: not 100% sure these are right
                scale = vec3.fromValues(2.0, 2.0, 2.0);
            }
            const new_gimmick = new gimmick
            (
                entry.position,
                entry.rotation,
                scale,
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    const WALL_HEIGHT_OFFSET = 30.0;
    if (layout.blockside_entries.length > 0)
    {
        const apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/blockside/skin/01/model.apak`));
        const fres = parseBFRES(get_file_by_name(apak, "blockside_01.bfres"));
        
        for (let i = 0; i < layout.blockside_entries.length; i++)
        {
            const entry = layout.blockside_entries[i];
            let scale = vec3.fromValues(1.0, 1.0, 1.0);
            let y_position = entry.position[1] - WALL_HEIGHT_OFFSET;
            // this map has the models scaled down
            if (level_id == "d018_03")
            {
                // TODO: not 100% sure these are right
                const test = 0.75
                scale = vec3.fromValues(test, test, test);
                y_position = entry.position[1] - 20.0;
            }
            const new_gimmick = new gimmick
            (
                vec3.fromValues(entry.position[0], y_position, entry.position[2]),
                entry.rotation,
                scale,
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    if (layout.blockwall_entries.length > 0)
    {
        const apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/blockwall/skin/01/model.apak`));
        const fres = parseBFRES(get_file_by_name(apak, "blockwall_01.bfres"));
        
        for (let i = 0; i < layout.blockwall_entries.length; i++)
        {
            const entry = layout.blockwall_entries[i];
            const new_gimmick = new gimmick
            (
                vec3.fromValues(entry.position[0], entry.position[1] - WALL_HEIGHT_OFFSET, entry.position[2]),
                entry.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    if (layout.warp_entries.length > 0)
    {
        const apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/warp/skin/01/model.apak`));
        const fres = parseBFRES(get_file_by_name(apak, "warp_01.bfres"));
        
        for (let i = 0; i < layout.warp_entries.length; i++)
        {
            const entry = layout.warp_entries[i];
            const new_gimmick = new gimmick
            (
                entry.position,
                entry.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    if (layout.gate_entries.length > 0)
    {
        const gate_00_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/00/model.apak`));
        const gate_01_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/01/model.apak`));
        // short
        const gate_02_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/02/model.apak`));
        const gate_05_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/05/model.apak`));
        // gold
        const gate_06_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/06/model.apak`));
        // dlc gate
        const gate_07_apak = parseAPAK(await data_fetcher.fetchData(`TokyoMirageSessionsSharpFE/gimmick/common/gate/skin/07/model.apak`));
        const fres = parseBFRES(get_file_by_name(gate_07_apak, "gate_07.bfres"));
        
        const GATE_HEIGHT_OFFSET = 20.0;
        for (let i = 0; i < layout.gate_entries.length; i++)
        {
            const entry = layout.gate_entries[i];
            const new_gimmick = new gimmick
            (
                vec3.fromValues(entry.position[0], entry.position[1] - GATE_HEIGHT_OFFSET, entry.position[2]),
                entry.rotation,
                vec3.fromValues(1.0, 1.0, 1.0),
                fres,
                device,
                new GfxRenderHelper(device),
            );
            gimmicks.push(new_gimmick);
        }
    }

    return gimmicks;
}
