import { DataStream } from "./util";
import { GfxDevice, GfxFormat, GfxSampler, GfxTexture, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { decodeTexture } from "../gx/gx_texture";
import { TexFormat, TexPalette } from "../gx/gx_enum";

export const FORMAT_C4 = 1;
export const FORMAT_C8 = 2;
export const FORMAT_RGB565 = 8;
export const FORMAT_RGB5A3 = 10;
export const FORMAT_RGBA8 = 12;
export const FORMAT_RGB8 = 13;

export const PALETTE_RGB5A3 = 1;
export const PALETTE_RGB565 = 2;
export const PALETTE_RGBA8 = 3;

export function readBitmap(data: DataStream) {
    const header = {
        width: data.readUint32(),
        height: data.readUint32(),
        unused: data.readJunk(4),
        format: data.readUint8(),
        flags: data.readUint8(),
        palette_format: data.readUint8(),
        opacity_level: data.readUint8(),
        unknown: data.readUint8(),
        filter: data.readUint8(),
    }
    let size = header.width * header.height;
    switch (header.format) {
        case FORMAT_C4:
            size = size / 2;
            break;
        case FORMAT_RGB565:
        case FORMAT_RGB5A3:
            size = size * 2;
            break;
        case FORMAT_RGB8:
            size = size * 3;
            break;
        case FORMAT_RGBA8:
            size = size * 4;
            break;
    }
    let palette_size = 0;
    if (header.format === FORMAT_C4 || header.format === FORMAT_C8) {
        const num_colors = header.format === FORMAT_C8 ? 256 : 16;
        switch (header.palette_format) {
            case PALETTE_RGB565:
            case PALETTE_RGB5A3:
                palette_size = num_colors * 2;
                break;
            case PALETTE_RGBA8:
                palette_size = num_colors * 4;
                break;
        }
    }
    return {
        ...header,
        pixel_data: data.readSlice(size),
        palette_data: data.readSlice(palette_size)
    }
}

export type TotemBitmap = ReturnType<typeof readBitmap>;

function getPaletteType(bitmap: TotemBitmap) {
    return bitmap.palette_format === PALETTE_RGB565 ? TexPalette.RGB565 :
           bitmap.palette_format === PALETTE_RGB5A3 ? TexPalette.RGB5A3 :
           bitmap.palette_format === PALETTE_RGBA8 ? TexPalette.RGBA8 :
           undefined;
}

export class Texture {
    public texture: GfxTexture;
    public sampler: GfxSampler;
    constructor(public id: number, bitmap: TotemBitmap, private device: GfxDevice) {
        this.texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, bitmap.width, bitmap.height, 1));
        device.setResourceName(this.texture, `T_${id}`);
        const rest = {
            width: bitmap.width,
            height: bitmap.height,
            mipCount: 1,
            name: `T_${id}`,
            data: bitmap.pixel_data,
        };
        switch (bitmap.format) {
            case FORMAT_RGBA8:
                decodeTexture({
                    format: TexFormat.RGBA8,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            case FORMAT_RGB565:
                decodeTexture({
                    format: TexFormat.RGB565,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            case FORMAT_RGB5A3:
                decodeTexture({
                    format: TexFormat.RGB5A3,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            // IGNORE for now
            // case FORMAT_RGB8:
            //     device.uploadTextureData(this.texture, 0, [ data.pixels ]);
            case FORMAT_C4:
                decodeTexture({
                    format: TexFormat.C4,
                    paletteFormat: getPaletteType(bitmap),
                    paletteData: bitmap.palette_data,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            case FORMAT_C8:
                decodeTexture({
                    format: TexFormat.C8,
                    paletteFormat: getPaletteType(bitmap),
                    paletteData: bitmap.palette_data,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            default:
                break;
        }
    }

    destroy() {
        this.device.destroyTexture(this.texture);
    }
}