
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";

export const enum ImageFormat {
    G_IM_FMT_RGBA = 0x00,
    G_IM_FMT_YUV  = 0x01,
    G_IM_FMT_CI   = 0x02,
    G_IM_FMT_IA   = 0x03,
    G_IM_FMT_I    = 0x04,
}

export const enum ImageSize {
    G_IM_SIZ_4b   = 0x00,
    G_IM_SIZ_8b   = 0x01,
    G_IM_SIZ_16b  = 0x02,
    G_IM_SIZ_32b  = 0x03,
}

export const enum TextureLUT {
    G_TT_NONE     = 0x00,
    G_TT_RGBA16   = 0x02,
    G_TT_IA16     = 0x03,
}

export const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02,
}

export const enum TextFilt {
    G_TF_POINT   = 0x00,
    G_TF_AVERAGE = 0x03,
    G_TF_BILERP  = 0x02,
}

function getSizBitsPerPixel(siz: ImageSize): number {
    switch (siz) {
    case ImageSize.G_IM_SIZ_4b:  return 4;
    case ImageSize.G_IM_SIZ_8b:  return 8;
    case ImageSize.G_IM_SIZ_16b: return 16;
    case ImageSize.G_IM_SIZ_32b: return 32;
    }
}

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

function getTLUTSize(siz: ImageSize) {
    switch (siz) {
    case ImageSize.G_IM_SIZ_4b:  return 0x10;
    case ImageSize.G_IM_SIZ_8b:  return 0x100;
    case ImageSize.G_IM_SIZ_16b: return 0x1000;
    case ImageSize.G_IM_SIZ_32b: return 0x10000;
    }
}

function expand4to8(n: number): number {
    return (n << (8 - 4)) | (n >>> (8 - 8));
}

function expand5to8(n: number): number {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function r5g5b5a1(dst: Uint8Array, dstOffs: number, p: number) {
    dst[dstOffs + 0] = expand5to8((p & 0xF800) >> 11);
    dst[dstOffs + 1] = expand5to8((p & 0x07C0) >> 6);
    dst[dstOffs + 2] = expand5to8((p & 0x003E) >> 1);
    dst[dstOffs + 3] = (p & 0x0001) ? 0xFF : 0x00;
}

function copyTLUTColor(dst: Uint8Array, dstOffs: number, colorTable: Uint8Array, i: number): void {
    dst[dstOffs + 0] = colorTable[(i * 4) + 0];
    dst[dstOffs + 1] = colorTable[(i * 4) + 1];
    dst[dstOffs + 2] = colorTable[(i * 4) + 2];
    dst[dstOffs + 3] = colorTable[(i * 4) + 3];
}

function decodeTex_RGBA16(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x ++) {
            const p = view.getUint16(srcIdx);
            r5g5b5a1(dst, dstIdx + 0, p);
            srcIdx += 0x02;
            dstIdx += 0x04;
        }
    }
}

function decodeTex_CI4(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number, tlutColorTable: Uint8Array): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcIdx);
            copyTLUTColor(dst, dstIdx + 0, tlutColorTable, (b >>> 4) & 0x0F);
            copyTLUTColor(dst, dstIdx + 4, tlutColorTable, (b >>> 0) & 0x0F);
            srcIdx += 0x01;
            dstIdx += 0x08;
        }
    }
}

function decodeTex_CI8(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number, tlutColorTable: Uint8Array): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x ++) {
            const b = view.getUint8(srcIdx);
            copyTLUTColor(dst, dstIdx + 4, tlutColorTable, b);
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
    }
}

function decodeTex_IA8(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcIdx);
            const i = expand4to8((b >>> 4) & 0x0F);
            const a = expand4to8((b >>> 0) & 0x0F);
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = a;
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
    }
}

function decodeTex_IA16(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x += 2) {
            const i = view.getUint8(srcIdx + 0x00);
            const a = view.getUint8(srcIdx + 0x01);
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = a;
            srcIdx += 0x02;
            dstIdx += 0x04;
        }
    }
}

function decodeTex_I4(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x += 2) {
            const b = view.getUint8(srcIdx);
            const i0 = expand4to8((b >>> 4) & 0x0F);
            dst[dstIdx + 0] = i0;
            dst[dstIdx + 1] = i0;
            dst[dstIdx + 2] = i0;
            dst[dstIdx + 3] = i0;
            const i1 = expand4to8((b >>> 0) & 0x0F);
            dst[dstIdx + 4] = i1;
            dst[dstIdx + 5] = i1;
            dst[dstIdx + 6] = i1;
            dst[dstIdx + 7] = i1;
            srcIdx += 0x01;
            dstIdx += 0x08;
        }
    }
}

function decodeTex_I8(dst: Uint8Array, view: DataView, srcIdx: number, tileW: number, tileH: number): void {
    let dstIdx = 0;
    for (let y = 0; y < tileH; y++) {
        for (let x = 0; x < tileW; x += 2) {
            const i = view.getUint8(srcIdx);
            dst[dstIdx + 0] = i;
            dst[dstIdx + 1] = i;
            dst[dstIdx + 2] = i;
            dst[dstIdx + 3] = i;
            srcIdx += 0x01;
            dstIdx += 0x04;
        }
    }
}

export function parse(buffer: ArrayBufferSlice): TextureArchive {
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

        // Read the palette.
        const tlutSize = getTLUTSize(image.siz);
        const tlut = new Uint8Array(tlutSize * 4);
        for (let i = 0; i < tlutSize; i++) {
            const p = view.getUint16(idx);
            r5g5b5a1(tlut, i * 4, p);
            idx += 0x02;
        }

        return tlut;
    }

    function parseImageLevel(image: Image, tlut: Uint8Array | null, width: number = image.width, height: number = image.height, dataOffs = image.dataOffs): void {
        const format = image.format, siz = image.siz;

        const dst = new Uint8Array(width * height * 4);
        image.levels.push(dst);

        if (format === ImageFormat.G_IM_FMT_RGBA && siz === ImageSize.G_IM_SIZ_16b) return decodeTex_RGBA16(dst, view, dataOffs, width, height);
        if (format === ImageFormat.G_IM_FMT_CI   && siz === ImageSize.G_IM_SIZ_4b)  return decodeTex_CI4(dst, view, dataOffs, width, height, tlut);
        if (format === ImageFormat.G_IM_FMT_CI   && siz === ImageSize.G_IM_SIZ_8b)  return decodeTex_CI8(dst, view, dataOffs, width, height, tlut);
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
