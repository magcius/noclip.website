
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString, assertExists } from "../../util";
import { parseTLUT, ImageFormat, ImageSize, TextFilt, TexCM, getSizBitsPerPixel, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_CI4, decodeTex_CI8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, decodeTex_I4, decodeTex_I8, TextureLUT, getTLUTSize } from "../../Common/N64/Image";

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

export interface TextureEnvironment {
    name: string;
    hasSecondImage: boolean;
    images: Image[];
    combineMode: number;
    texFilter: TextFilt;
}

export interface TextureArchive {
    textureEnvironments: TextureEnvironment[];
}

export function parseTextureArchive(buffer: ArrayBufferSlice): TextureArchive {
    const view = buffer.createDataView();

    function readImageBase(name: string, attr0: number, attr1: number, attr2: number, attr3: number, advanceIdx: boolean = true, heightShift: number = 0): Image {
        const width = (attr0 >>> 0) & 0xFFFF;
        const height = ((attr1 >>> 0) & 0xFFFF) >>> heightShift;

        const format: ImageFormat = (attr2 >>> 0) & 0x0F;
        const siz: ImageSize = (attr3 >>> 24) & 0x0F;

        const cms: TexCM = (attr3 >>> 16) & 0x0F;
        const cmt: TexCM = (attr3 >>> 8) & 0x0F;

        const levels: Uint8Array[] = [];
        const dataOffs = idx;

        if (advanceIdx) {
            const dataSizeBits = (getSizBitsPerPixel(siz) * width * height) >>> 3;
            idx += dataSizeBits;
        }

        return { name, width, height, format, siz, cms, cmt, levels, dataOffs };
    }

    function readImagePalette(image: Image): Uint8Array | null {
        if (image.format !== ImageFormat.G_IM_FMT_CI)
            return null;


        const tlutSize = getTLUTSize(image.siz);
        const tlut = new Uint8Array(tlutSize * 4);
        idx += parseTLUT(tlut, view, idx, image.siz, TextureLUT.G_TT_RGBA16);
        return tlut;
    }

    function parseImageLevel(image: Image, tlut: Uint8Array | null, width: number = image.width, height: number = image.height, dataOffs = image.dataOffs): void {
        const format = image.format, siz = image.siz;

        const dst = new Uint8Array(width * height * 4);
        image.levels.push(dst);

        if (format === ImageFormat.G_IM_FMT_RGBA && siz === ImageSize.G_IM_SIZ_16b) return decodeTex_RGBA16(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_RGBA && siz === ImageSize.G_IM_SIZ_32b) return decodeTex_RGBA32(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_CI   && siz === ImageSize.G_IM_SIZ_4b)  return decodeTex_CI4(dst, view, dataOffs, width, height, assertExists(tlut));
        if (format === ImageFormat.G_IM_FMT_CI   && siz === ImageSize.G_IM_SIZ_8b)  return decodeTex_CI8(dst, view, dataOffs, width, height, assertExists(tlut));
        if (format === ImageFormat.G_IM_FMT_IA   && siz === ImageSize.G_IM_SIZ_4b)  return decodeTex_IA4(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_IA   && siz === ImageSize.G_IM_SIZ_8b)  return decodeTex_IA8(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_IA   && siz === ImageSize.G_IM_SIZ_16b) return decodeTex_IA16(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_I    && siz === ImageSize.G_IM_SIZ_4b)  return decodeTex_I4(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_I    && siz === ImageSize.G_IM_SIZ_8b)  return decodeTex_I8(dst, view, dataOffs, width, height);
        console.warn(`Unknown texture format ${format} / ${siz}`);
    }

    let idx = 0;
    const textureEnvironments: TextureEnvironment[] = [];
    while (idx < buffer.byteLength) {
        const name = readString(buffer, idx + 0x00, 0x20, true);
        const attr0 = view.getUint32(idx + 0x20);
        const attr1 = view.getUint32(idx + 0x24);
        const attr2 = view.getUint32(idx + 0x28);
        const attr3 = view.getUint32(idx + 0x2C);

        idx += 0x30;

        // Data type.
        const imageStorageType = (attr2 >>> 16) & 0x0F;
        const combineMode = (attr2 >>> 8) & 0xFF;

        const texFilter = (attr3 >>> 0) & 0x0F;

        const images: Image[] = [];
        if (imageStorageType === 0) {
            // One image, nothing fancy.
            const image = readImageBase(name, attr0 >>> 0, attr1 >>> 0, attr2 >>> 0, attr3 >>> 0);
            const tlut = readImagePalette(image);
            parseImageLevel(image, tlut);
            images.push(image);
        } else if (imageStorageType === 1) {
            // Mipmaps. CI format images use the same TLUT data, located after all images.
            const image = readImageBase(name, attr0 >>> 0, attr1 >>> 0, attr2 >>> 0, attr3 >>> 0, false);

            // Skip over the level datas.
            const widthCap = (32 >>> image.siz);
            const dataSizeBits = getSizBitsPerPixel(image.siz);

            let widthIter = image.width;
            let heightIter = image.height;
            while (true) {
                // Read data.
                idx += (dataSizeBits * widthIter * heightIter) >>> 3;
                if (widthIter < widthCap)
                    break;
                widthIter /= 2;
                heightIter /= 2;
            }

            // Parse the TLUT.
            const tlut = readImagePalette(image);

            // Now go through and parse each level.
            let dataIdx = image.dataOffs;
            widthIter = image.width;
            heightIter = image.height;
            while (true) {
                parseImageLevel(image, tlut, widthIter, heightIter, dataIdx);
                dataIdx += (dataSizeBits * widthIter * heightIter) >>> 3;
                if (widthIter < widthCap)
                    break;
                widthIter /= 2;
                heightIter /= 2;
            }
            images.push(image);
        } else if (imageStorageType === 2) {
            // Two images, using the same settings. CI format images use the same TLUT
            // data, located after both images. It's effectively stored as one double-height image.
            const image0 = readImageBase(`${name}0`, attr0 >>> 0, attr1 >>> 0, attr2 >>> 0, attr3 >>> 0, true, 1);
            const image1 = readImageBase(`${name}1`, attr0 >>> 0, attr1 >>> 0, attr2 >>> 0, attr3 >>> 0, true, 1);
            const tlut = readImagePalette(image0);
            parseImageLevel(image0, tlut);
            parseImageLevel(image1, tlut);
            images.push(image0);
            images.push(image1);
        } else if (imageStorageType === 3) {
            // Two images, using separate settings. CI format images use separate TLUT
            // data, located after each image.
            const image0 = readImageBase(`${name}0`, attr0 >>> 0, attr1 >>> 0, attr2 >>> 0, attr3 >>> 0);
            const tlut0 = readImagePalette(image0);
            const image1 = readImageBase(`${name}1`, attr0 >>> 16, attr1 >>> 16, attr2 >>> 4, attr3 >>> 4);
            const tlut1 = readImagePalette(image1);
            parseImageLevel(image0, tlut0);
            parseImageLevel(image1, tlut1);
            images.push(image0);
            images.push(image1);
        } else {
            throw "whoops";
        }

        const hasSecondImage = images.length === 2;
        textureEnvironments.push({ name, images, hasSecondImage, combineMode, texFilter });
    }

    return { textureEnvironments };
}

const ramAddrBase = 0x80200000;
export function parseBackground(buffer: ArrayBufferSlice, name: string, offs: number = 0x00): Image {
    const view = buffer.createDataView();
    const imageOffs = view.getUint32(0x00) - ramAddrBase;
    const paletteOffs = view.getUint32(0x04) - ramAddrBase;
    const width = view.getUint16(0x0C);
    const height = view.getUint16(0x0E);

    const format = ImageFormat.G_IM_FMT_CI;
    const siz = ImageSize.G_IM_SIZ_8b;
    const tlutSize = getTLUTSize(siz);
    const tlut = new Uint8Array(tlutSize * 4);
    parseTLUT(tlut, view, paletteOffs, siz, TextureLUT.G_TT_RGBA16);

    const dst = new Uint8Array(width * height * 4);
    const levels: Uint8Array[] = [dst];
    decodeTex_CI8(dst, view, imageOffs, width, height, tlut);

    return { name, format, siz, width, height, levels, dataOffs: 0, cms: 0, cmt: 0 };
}
