// `.txg` - the texture container the HAL/HSD sysdolphin particle system uses

import * as GX from '../gx/gx_enum.js';

import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { calcTextureSize } from "../gx/gx_texture.js";
import { Tpl, TplTexture } from "./Tpl.js";

//#region Records

export interface Txg extends Tpl {
    groupBase: number[];
    groupFrameCount: number[];
}

//#endregion

//#region Parsing

const NO_OFFSET = 0xFFFFFFFF;
const MAX_FRAMES = 2;

export function parse(buffer: ArrayBufferSlice, namePrefix: string = "txg"): Txg {
    const view = buffer.createDataView();

    const numImages = view.getUint32(0x00);
    const textures: TplTexture[] = [];
    const groupBase: number[] = [];
    const groupFrameCount: number[] = [];

    for (let i = 0; i < numImages; i++) {
        const headerOffs = view.getUint32(0x04 + i * 0x04);

        const format: GX.TexFormat = view.getUint32(headerOffs + 0x04);
        const width = view.getUint32(headerOffs + 0x0C);
        const height = view.getUint32(headerOffs + 0x10);

        groupBase.push(textures.length);
        let frames = 0;
        for (let f = 0; f < MAX_FRAMES; f++) {
            const dataOffs = view.getUint32(headerOffs + 0x18 + f * 0x04);
            if (dataOffs === NO_OFFSET)
                break;
            frames++;
            textures.push({
                name: `${namePrefix}_img${i}_f${f}`,
                mipCount: 1,
                data: buffer.subarray(dataOffs, calcTextureSize(format, width, height)),
                width, height, format,
                wrapS: GX.WrapMode.CLAMP,
                wrapT: GX.WrapMode.CLAMP,
                minFilter: GX.TexFilter.LINEAR,
                magFilter: GX.TexFilter.LINEAR,
                lodBias: 0, edgeLOD: 0, minLOD: 0, maxLOD: 0,
                paletteFormat: GX.TexPalette.IA8,
                paletteData: null,
            });
        }
        groupFrameCount.push(frames);
    }

    return { textures, groupBase, groupFrameCount };
}

//#endregion
