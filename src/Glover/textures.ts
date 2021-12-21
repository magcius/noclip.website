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

function blur_ci8(data: Uint8Array, width: number, height: number): void {
    if (width == 0) {
        return;
    }
    let idx = 0;
    const pixels = width * height;
    const palette_shift = 2;
    for (let i = 0; i < width; i += 1) {
        for (let j = 0; j < width; j += 1) {
            const right = (idx + 1) % pixels;
            const left = (idx + pixels - 1) % pixels;
            const bottom = (idx + height) % pixels;
            const top = ((idx - height) + pixels) % pixels;
            data[idx] = ((data[right] + data[left] + data[bottom] + data[top]) / 4) + palette_shift;
            idx += 1;
        }
    }
}


function textureToCanvas(texture: Image): Viewer.Texture {
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
    private banks: GloverTexbank[] = [];
    private idToBank = new Map<number, number>();
    public idToTexture = new Map<number, GloverTexbank.Texture>();

    private animatedTextures: GloverTexbank.Texture[] = [];
    public lastAnimationTick: number = 0;

    public addTextureBank(device: GfxDevice, bank: GloverTexbank) : void {
        this.banks.push(bank)
        let images = [];
        for (let texture of bank.asset) {

            this.idToBank.set(texture.id, this.banks.length - 1);
            this.idToTexture.set(texture.id, texture);

            if ((texture.flags & 0x4) != 0) {
                this.animatedTextures.push(texture);
            }

            // Hard-coded blur for animated portal texture
            if (texture.id == 0x0fe4919b) {
                for (let i = 0; i < 50; i++) {
                    blur_ci8(texture.data, texture.width, texture.height);
                }
            }

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

    public animatePalettes(viewerInput: Viewer.ViewerRenderInput) : void {

        // TODO: if you go to another level and then back to atlantis 1,
        //       textures stop animating. look into why.

        if (viewerInput.time > this.lastAnimationTick + 50) {
            this.lastAnimationTick = viewerInput.time;

            let portalTex = this.idToTexture.get(0x0fe4919b)
            if (portalTex !== undefined) {
                blur_ci8(portalTex.data, portalTex.width, portalTex.height);
            }

            let bubbleTex = this.idToTexture.get(0x6d9343f9)
            if (bubbleTex !== undefined) {
                blur_ci8(bubbleTex.data, bubbleTex.width, bubbleTex.height);
            }


            for (let texture of this.animatedTextures) {

                const palette = ArrayBufferSlice.fromView(texture.data).createTypedArray(Uint16Array, texture.paletteOffset - texture.dataPtr);

                if (texture.frameIncrement < 0) {
                    texture.frameCounter += -texture.frameIncrement;
                } else {
                    texture.frameCounter += texture.frameIncrement;
                }

                while (texture.frameCounter > 63) {
                    if (texture.frameIncrement < 1) {
                        let tmp = palette[texture.paletteAnimIdxMax];
                        for (let colorIdx = texture.paletteAnimIdxMax; colorIdx > texture.paletteAnimIdxMin; colorIdx -= 1) {
                            palette[colorIdx] = palette[colorIdx - 1];
                        }
                        palette[texture.paletteAnimIdxMin] = tmp;
                    } else {
                        let tmp = palette[texture.paletteAnimIdxMin];
                        for (let colorIdx = texture.paletteAnimIdxMin; colorIdx < texture.paletteAnimIdxMax; colorIdx += 1) {
                            palette[colorIdx] = palette[colorIdx + 1];
                        }
                        palette[texture.paletteAnimIdxMax] = tmp;
                    }                 
                    texture.frameCounter -= 64;
                }
            }
        }
    }

    public textureSegments() : ArrayBufferSlice[] {
        const segments: ArrayBufferSlice[] = Array(16);
        for (let bankIdx = 0; bankIdx < this.banks.length; bankIdx++) {
            segments[bankIdx+1] = new ArrayBufferSlice(this.banks[bankIdx]._io.buffer);
        }
        return segments;
    }

    public getSegmentPaletteAddr(id: number) : number | undefined {
        const bank = this.idToBank.get(id);
        const texture = this.idToTexture.get(id);
        if (bank !== undefined && texture !== undefined) {
            const segmentBaseAddr = (bank + 1) << 24;
            const textureBaseAddr = texture._debug.id.start;
            const offset = texture.paletteOffset;
            return segmentBaseAddr + textureBaseAddr + offset;
        } else {
            return undefined;
        }
    }
    public getSegmentDataAddr(id: number) : number | undefined {
        const bank = this.idToBank.get(id);
        const texture = this.idToTexture.get(id);
        if (bank !== undefined && texture !== undefined) {
            const segmentBaseAddr = (bank + 1) << 24;
            const textureBaseAddr = texture._debug.id.start;
            const offset = texture.dataPtr;
            return segmentBaseAddr + textureBaseAddr + offset;
        } else {
            return undefined;
        }
    }
    public isDynamic(id: number) : boolean {

        if (id === 0x0fe4919b) return true; // portal texture
        if (id === 0x6d9343f9) return true; // bubble texture

        const bank = this.idToBank.get(id);
        const texture = this.idToTexture.get(id);
        if (bank !== undefined && texture !== undefined) {
            return (texture.flags & 4) != 0;
        } else {
            return false;
        }
    }

    public loadTexture(device: GfxDevice, texture: Image): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.levels.length));
        device.setResourceName(gfxTexture, texture.name);
        device.uploadTextureData(gfxTexture, 0, texture.levels);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

