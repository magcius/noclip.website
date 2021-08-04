import { DataStream } from "../util";
import { GfxDevice, GfxFormat, GfxSampler, GfxTexture, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform";
import { decodeTexture } from "../../gx/gx_texture";
import { TexFormat, TexPalette } from "../../gx/gx_enum";

const FORMAT_C4 = 1;
const FORMAT_C8 = 2;
const FORMAT_RGB565 = 8;
const FORMAT_RGB5A3 = 10;
const FORMAT_RGBA8 = 12;
const FORMAT_RGB8 = 13;

const PALETTE_RGB5A3 = 1;
const PALETTE_RGB565 = 2;
const PALETTE_RGBA8 = 3;

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
           undefined;
}

function getFormatType(bitmap: TotemBitmap) {
    return bitmap.format === FORMAT_RGBA8 ? TexFormat.RGBA8 :
           bitmap.format === FORMAT_RGB565 ? TexFormat.RGB565 :
           bitmap.format === FORMAT_RGB565 ? TexFormat.RGB5A3 :
           bitmap.format === FORMAT_C4 ? TexFormat.C4 :
           bitmap.format === FORMAT_C8 ? TexFormat.C8 :
           undefined;
}

export class Texture {
    public texture: GfxTexture;
    public sampler: GfxSampler;
    public alphaLevel: number;
    constructor(public id: number, bitmap: TotemBitmap, private device: GfxDevice) {
        this.alphaLevel = bitmap.opacity_level;
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
            case FORMAT_RGB565:
            case FORMAT_RGB5A3:
                decodeTexture({
                    format: getFormatType(bitmap)!,
                    ...rest
                }).then(data => {
                    device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                });
                break;
            case FORMAT_RGB8:
                if (bitmap.filter === 5) {
                    // special case. Do not ask me why it is like this, I do not know.
                    let newData = new Uint8Array(bitmap.width * bitmap.height * 4);
                    // copy existing bytes
                    const view = bitmap.pixel_data.createDataView();
                    for (let i = 0; i < bitmap.pixel_data.byteLength; i++) {
                        newData[i] = view.getUint8(i);
                    }
                    // replace rest with garbage for the authentic crust experience.
                    // Not even joking: https://github.com/Jellonator/chum-world/wiki/BITMAP
                    for (let i = bitmap.pixel_data.byteLength; i < bitmap.width * bitmap.height * 4; i++) {
                        newData[i] = Math.floor(Math.random() * 256);
                    }
                    decodeTexture({
                        format: TexFormat.RGBA8,
                        ...rest
                    }).then(data => {
                        device.uploadTextureData(this.texture, 0, [ newData ]);
                    });
                }
                else {
                    let newData = new Uint8Array(bitmap.width * bitmap.height * 4);
                    const view = bitmap.pixel_data.createDataView();
                    for (let i = 0; i < bitmap.width * bitmap.height; i++) {
                        const r = view.getUint8(i*3);
                        const g = view.getUint8(i*3+1);
                        const b = view.getUint8(i*3+2);
                        newData[i*4] = r;
                        newData[i*4+1] = g;
                        newData[i*4+2] = b;
                        newData[i*4+3] = 255;
                    }
                    device.uploadTextureData(this.texture, 0, [ newData ]);
                }
                break;
            case FORMAT_C4:
            case FORMAT_C8:
                if (bitmap.palette_format !== PALETTE_RGBA8) {
                    // turns out, RGBA8 palette is not used anywhere except in one
                    // specific menu texture in Jimmy Neutron: Boy Genius
                    decodeTexture({
                        format: getFormatType(bitmap)!,
                        paletteFormat: getPaletteType(bitmap),
                        paletteData: bitmap.palette_data,
                        ...rest
                    }).then(data => {
                        device.uploadTextureData(this.texture, 0, [ data.pixels ]);
                    });
                }
                break;
            default:
                break;
        }
    }

    public destroy() {
        this.device.destroyTexture(this.texture);
    }
}