// lightmap.ts
// handles lightmap textures contained in .atlm files

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import * as BNTX from "../fres_nx/bntx.js";
import { deswizzle_and_upload_bntx_textures } from "./bntx_helpers.js";
import { GfxTexture, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { assert, readString } from "../util.js";

export function parse_atlm(buffer: ArrayBufferSlice, device: GfxDevice): LightmapTexture[]
{
    assert(readString(buffer, 0x0, 0x04) === 'atlm');
    
    const view = buffer.createDataView();

    // TODO: determine this dynamically
    let little_endian = true;

    const lightmap_array_offset = view.getUint32(0xC, little_endian);
    const count = view.getUint32(0x10, little_endian);
    const bntx_offset = view.getUint32(0x14, little_endian);
    const bntx_data = buffer.subarray(bntx_offset);
    const bntx = BNTX.parse(bntx_data);
    const gfx_texture_array: GfxTexture[] = deswizzle_and_upload_bntx_textures(bntx, device);

    let lightmap_array: LightmapTexture[] = [];
    let lightmap_entry_offset = lightmap_array_offset;
    for (let i = 0; i < count; i++)
    {
        const bone_name_offset = view.getUint32(lightmap_entry_offset + 0x10, little_endian);
        const bone_name = readString(buffer, bone_name_offset, 0xFF, true);
        const texure_index = view.getUint32(lightmap_entry_offset + 0x14, little_endian);
        const gfx_texture = gfx_texture_array[texure_index];

        lightmap_array.push({ bone_name, gfx_texture });
        lightmap_entry_offset += LIGHTMAP_ENTRY_SIZE;
    }

    return lightmap_array;
}

const LIGHTMAP_ENTRY_SIZE = 0x30;

export interface LightmapTexture
{
    bone_name: string;
    gfx_texture: GfxTexture;
}
