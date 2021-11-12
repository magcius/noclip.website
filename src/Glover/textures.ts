import * as Viewer from '../viewer';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { parseTLUT, ImageFormat, ImageSize, TextFilt, TexCM,
         decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_CI4,
         decodeTex_CI8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16,
         decodeTex_I4, decodeTex_I8,
         TextureLUT, getTLUTSize } from "../Common/N64/Image";
import { getImageFormatString } from "../BanjoKazooie/f3dex";
import { GfxDevice, GfxFormat, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { convertToCanvas } from '../gfx/helpers/TextureConversionHelpers';

import { GloverTexbank } from './parsers';

export interface Image {
    name: string;
    width: number;
    height: number;
    format: ImageFormat;
    siz: ImageSize;
    cms: TexCM;
    cmt: TexCM;
    levels: Uint8Array[];
    dataOffs: number;
}

function textureToCanvas(texture: Image): Viewer.Texture {
    // TODO: use the BanjoKazooie implementation rather than
    //       redefining here
    const surfaces: HTMLCanvasElement[] = [];

    for (let i = 0; i < texture.levels.length; i++) {
        const width = texture.width >>> i;
        const height = texture.height >>> i;
        const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.levels[i]), width, height);
        surfaces.push(canvas);
    }

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.format, texture.siz));

    return { name: texture.name, extraInfo, surfaces };
}


export class GloverTextureHolder extends TextureHolder<Image> {
    public addTextureBank(device: GfxDevice, bank: GloverTexbank) : void {
        let images = [];
        for (let texture of bank.asset) {

            // TODO: properly apply blur to "restart.bmp"

            var colorFormat = texture.colorFormat as number as ImageFormat;
            if (texture.compressionFormat == GloverTexbank.TextureCompressionFormat.CI4 || 
                texture.compressionFormat == GloverTexbank.TextureCompressionFormat.CI8)
            {
                colorFormat = ImageFormat.G_IM_FMT_CI;
            }                
            const image = <Image> {
                name: texture.id.toString(16),
                width: texture.width,
                height: texture.height,
                format: colorFormat,
                siz: texture.compressionFormat as number as ImageSize,
                cms: 0, // TODO: where is CMS specified?
                cmt: 0, // TODO: where is CMT specified?
                levels: [],
                dataOffs: 0,
            };

            let tlut : Uint8Array | null = null;
            if (image.format === ImageFormat.G_IM_FMT_CI) {
                const tlutSize = getTLUTSize(image.siz);
                const tlutView = ArrayBufferSlice.fromView(texture.data).createDataView(texture.paletteOffset - texture.dataPtr);
                tlut =  new Uint8Array(tlutSize * 4);
                // TODO: support RGBA32
                parseTLUT(tlut, tlutView, 0, image.siz, TextureLUT.G_TT_RGBA16);
            }

            const dataView = ArrayBufferSlice.fromView(texture.data).createDataView();
            const dst = new Uint8Array(image.width * image.height * 4);
            image.levels.push(dst);

            if (image.format === ImageFormat.G_IM_FMT_RGBA && image.siz === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_RGBA && image.siz === ImageSize.G_IM_SIZ_32b) decodeTex_RGBA32(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_CI   && image.siz === ImageSize.G_IM_SIZ_4b)  decodeTex_CI4(dst, dataView, image.dataOffs, image.width, image.height, tlut!);
            else if (image.format === ImageFormat.G_IM_FMT_CI   && image.siz === ImageSize.G_IM_SIZ_8b)  decodeTex_CI8(dst, dataView, image.dataOffs, image.width, image.height, tlut!);
            else if (image.format === ImageFormat.G_IM_FMT_IA   && image.siz === ImageSize.G_IM_SIZ_4b)  decodeTex_IA4(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_IA   && image.siz === ImageSize.G_IM_SIZ_8b)  decodeTex_IA8(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_IA   && image.siz === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_I    && image.siz === ImageSize.G_IM_SIZ_4b)  decodeTex_I4(dst, dataView, image.dataOffs, image.width, image.height);
            else if (image.format === ImageFormat.G_IM_FMT_I    && image.siz === ImageSize.G_IM_SIZ_8b)  decodeTex_I8(dst, dataView, image.dataOffs, image.width, image.height);
            else console.warn(`Unknown texture format ${image.format} / ${image.siz}`);

            images.push(image);
        }

        this.addTextures(device, images);
    }

    public loadTexture(device: GfxDevice, texture: Image): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.levels.length));
        device.setResourceName(gfxTexture, texture.name);
        device.uploadTextureData(gfxTexture, 0, texture.levels);


        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

