import { decompressBC } from "../../Common/bc_texture.js";
import { align } from "../../util.js";
import { RwEngine, RwRaster, RwRasterFormat, RwStream, RwTexture } from "./rwcore.js";

function RGBAToBGRA(pixels: Uint8Array) {
    for (let i = 0; i < pixels.byteLength; i += 4) {
        const r = pixels[i+0];
        pixels[i+0] = pixels[i+2];
        pixels[i+2] = r;
    }
}

function unswizzle(dst: Uint8Array, src: Uint8Array, width: number, height: number) {
    let maskU = 0;
    let maskV = 0;
    {
        let i = 1;
        let j = 1;
        let k;
        do {
            k = 0;
            if (i < width) {
                maskU |= j;
                k = (j <<= 1);
            }
            if (i < height) {
                maskV |= j;
                k = (j <<= 1);
            }
            i <<= 1;
        } while (k);
    }

    let v = 0;
    for (let y = 0; y < height; y++) {
        let u = 0;
        for (let x = 0; x < width; x++) {
            const swizzleIndex = u | v;
            const swizzleX = swizzleIndex % width;
            const swizzleY = Math.floor(swizzleIndex / width);
            if (x < width && y < height) {
                const dstOff = (y * width + x) * 4;
                if (swizzleX < width && swizzleY < height) {
                    const srcOff = (swizzleY * width + swizzleX) * 4;
                    dst[dstOff + 0] = src[srcOff + 0];
                    dst[dstOff + 1] = src[srcOff + 1];
                    dst[dstOff + 2] = src[srcOff + 2];
                    dst[dstOff + 3] = src[srcOff + 3];
                } else {
                    dst[dstOff + 0] = 0;
                    dst[dstOff + 1] = 0;
                    dst[dstOff + 2] = 0;
                    dst[dstOff + 3] = 0;
                }
            }
            u = (u - maskU) & maskU;
        }
        v = (v - maskV) & maskV;
    }
}

const enum DXTFormat {
    DXT1 = 12,
    DXT2 = 13,
    DXT3 = 14,
    DXT4 = 16,
    DXT5 = 15,
}

export function readXboxTexture(stream: RwStream, rw: RwEngine): RwTexture | null {
    // Texture
    const filterAndAddress = stream.readUint32();
    const name = stream.readString(32);
    const mask = stream.readString(32);

    // Raster
    const format = stream.readUint32();
    const alpha = stream.readUint16();
    const cubeMap = stream.readUint16();
    const width = stream.readUint16();
    const height = stream.readUint16();
    const depth = stream.readUint8();
    const numMipLevels = stream.readUint8();
    const type = stream.readUint8();
    const dxtFormat = stream.readUint8();
    const unknown = stream.readUint32();

    switch (dxtFormat) {
    case DXTFormat.DXT2:
        console.error("DXT2 compression currently unsupported");
        return null;
    case DXTFormat.DXT4:
        console.error("DXT4 compression currently unsupported");
        return null;
    }

    const raster = new RwRaster(rw, width, height, depth, format);

    let palette: Uint8Array | null = null;
    if (format & (RwRasterFormat.PAL4 | RwRasterFormat.PAL8)) {
        const palSize = 4 * ((format & RwRasterFormat.PAL4) ? 32 : 256);
        palette = stream.readArray(Uint8Array, palSize);
    }

    for (let i = 0; i < numMipLevels; i++) {
        let mipWidth = (width >>> i);
        let mipHeight = (height >>> i);
        if (dxtFormat !== 0) {
            mipWidth = align(mipWidth, 4);
            mipHeight = align(mipHeight, 4);
        }

        const numPixels = mipWidth * mipHeight;
        if (numPixels === 0) {
            continue;
        }

        const pixels = raster.lock(rw, i);

        if (palette) {
            const indSize = mipWidth * mipHeight;
            const indices = stream.readArray(Uint8Array, indSize);

            const swizzledPixels = new Uint8Array(4 * numPixels);
            for (let i = 0; i < numPixels; i++) {
                swizzledPixels[i*4+0] = palette[indices[i]*4+0];
                swizzledPixels[i*4+1] = palette[indices[i]*4+1];
                swizzledPixels[i*4+2] = palette[indices[i]*4+2];
                swizzledPixels[i*4+3] = palette[indices[i]*4+3];
            }

            RGBAToBGRA(swizzledPixels);
            unswizzle(pixels, swizzledPixels, mipWidth, mipHeight);
        } else if (dxtFormat !== 0) {
            switch (dxtFormat) {
            case DXTFormat.DXT1:
            {
                const data = stream.readArray(Uint8Array, numPixels / 2);
                pixels.set(decompressBC({ width: mipWidth, height: mipHeight, depth: 1, pixels: data, type: 'BC1', flag: 'SRGB' }).pixels.slice(0, pixels.byteLength));
                break;
            }
            case DXTFormat.DXT3:
            {
                const data = stream.readArray(Uint8Array, numPixels);
                pixels.set(decompressBC({ width: mipWidth, height: mipHeight, depth: 1, pixels: data, type: 'BC2', flag: 'SRGB' }).pixels.slice(0, pixels.byteLength));
                break;
            }
            // Untested
            case DXTFormat.DXT5:
            {
                const data = stream.readArray(Uint8Array, numPixels);
                pixels.set(decompressBC({ width: mipWidth, height: mipHeight, depth: 1, pixels: data, type: 'BC3', flag: 'SRGB' }).pixels.slice(0, pixels.byteLength));
                break;
            }
            }
        } else {
            const swizzledPixels = stream.readArray(Uint8Array, 4 * numPixels);
            RGBAToBGRA(swizzledPixels);
            unswizzle(pixels, swizzledPixels, mipWidth, mipHeight);
        }

        raster.unlock(rw);
    }

    const texture = new RwTexture();
    texture.name = name;
    texture.mask = mask;
    texture.filter = filterAndAddress & 0xFF;
    texture.addressingU = (filterAndAddress >>> 8) & 0xF;
    texture.addressingV = (filterAndAddress >>> 12) & 0xF;
    texture.raster = raster;
    
    return texture;
}