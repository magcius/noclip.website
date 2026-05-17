import { Color } from "../Color";
import { DataViewExt } from "./DataViewExt";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { SkyHeader, SkyTextureEntry } from "./bin-core";
import { TieInstance } from "./bin-gameplay";
import { assert } from "../util";
import { TextureEntry } from "./bin-index";

export interface PaletteTexture {
    name: string,
    textureEntry: { width: number, height: number },
    pixels: Uint8Array,
    palette: Color[],
    hasAlpha: boolean,
};

export function readPalette8TextureWithPaletteInGsRam(textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number): PaletteTexture {
    const pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
    };
}

export function readPalette8TextureSky(skyView: DataViewExt, skyHeader: SkyHeader, textureEntry: SkyTextureEntry, i: number): PaletteTexture {
    const pixels = skyView.subview(skyHeader.textureData + textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    let rgbaPalette = skyView.subview(skyHeader.textureData + textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = fixPalette(rgbaPalette);

    return {
        name: `Sky Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
    };
}

// return true if any pixel is transparent
export function paletteHasAlpha(pixels: Uint8Array, palette: Color[]) {
    // we can't just check the palette because the texture might not use all the palette colors
    for (let i = 0; i < pixels.length; i++) {
        if (palette[pixels[i]].a < 255) {
            return true;
        }
    }
    return false;
}

// Shuffle some indices around then double all the alphas
function fixPalette(palette: Color[]) {
    const newPalette = [...palette]

    for (let i = 0; i < palette.length; i++) {
        newPalette[i] = palette[mapPaletteIndices(i)];
    }

    for (let i = 0; i < newPalette.length; i++) {
        newPalette[i] = { ...newPalette[i], a: Math.min(newPalette[i].a * 2, 255) };
    }

    return newPalette;
}

function mapPaletteIndices(index: number) {
    // swap the two middle bits for some reason
    return (((index & 0b00010000) >> 1) != (index & 0b00001000)) ? (index ^ 0b00011000) : index;
}

// convert palette texture to regular RGBA texture
function unpalettizeTexture(texture: PaletteTexture): Uint8Array {
    const palettedPixels = new Uint32Array(texture.textureEntry.width * texture.textureEntry.height);
    for (let i = 0; i < palettedPixels.length; i++) {
        const paletteIndex = texture.pixels[i];
        const rgba = texture.palette[paletteIndex];
        palettedPixels[i] = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    }
    return new Uint8Array(palettedPixels.buffer, palettedPixels.byteOffset, palettedPixels.byteLength);
}

// scale down texture by 2x using box filter
function downscale(textureData: Uint8Array): Uint8Array {
    const originalDim = Math.sqrt(textureData.length / 4);
    if (!Number.isInteger(originalDim)) {
        throw new Error(`Texture data is not a square`);
    }
    const dim = originalDim / 2;
    assert(Number.isInteger(dim));
    assert(dim > 0);
    const downscaled = new Uint8Array(dim * dim * 4);
    for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
            const srcX = x * 2;
            const srcY = y * 2;
            const dstIndex = (y * dim + x) * 4;
            // Average 2x2 pixels
            for (let c = 0; c < 4; c++) {
                const p1 = textureData[((srcY + 0) * originalDim + (srcX + 0)) * 4 + c];
                const p2 = textureData[((srcY + 0) * originalDim + (srcX + 1)) * 4 + c];
                const p3 = textureData[((srcY + 1) * originalDim + (srcX + 0)) * 4 + c];
                const p4 = textureData[((srcY + 1) * originalDim + (srcX + 1)) * 4 + c];
                downscaled[dstIndex + c] = Math.floor((p1 + p2 + p3 + p4) / 4);
            }
        }
    }
    return downscaled;
}

export function createGfxTextureForPaletteTexture(device: GfxDevice, texture: PaletteTexture): { pixelsTexture: GfxTexture } {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.textureEntry.width, texture.textureEntry.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    const palettedPixels = new Uint32Array(texture.textureEntry.width * texture.textureEntry.height);
    for (let i = 0; i < palettedPixels.length; i++) {
        const paletteIndex = texture.pixels[i];
        const rgba = texture.palette[paletteIndex];
        palettedPixels[i] = rgba.r | (rgba.g << 8) | (rgba.b << 16) | (rgba.a << 24);
    }
    const asUint8 = new Uint8Array(palettedPixels.buffer, palettedPixels.byteOffset, palettedPixels.byteLength);
    device.uploadTextureData(gfxTexture, 0, [asUint8]);
    return {
        pixelsTexture: gfxTexture
    };
}

export function create1x1x1ErrorArrayTexture(device: GfxDevice): GfxTexture {
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, 'Error Texture Array');
    const errorPixel = new Uint8Array([255, 0, 255, 255]);
    device.uploadTextureData(gfxTexture, 0, [errorPixel]);
    return gfxTexture;
}

/**
 * Pack many palette textures into a big texture array.
 */
export function createGfxTextureArrayForPaletteTextures(device: GfxDevice, name: string, textures: PaletteTexture[]) {
    if (textures.length === 0) {
        return create1x1x1ErrorArrayTexture(device);
    }

    const dim = Math.max(...textures.map(t => t.textureEntry.width));
    const numLevels = Math.log2(dim) + 1;
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2DArray,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: dim,
        height: dim,
        depthOrArrayLayers: textures.length,
        numLevels: numLevels,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, name);

    const mipLevels: Uint8Array[] = [];
    const ptrs = new Array(numLevels).fill(0);
    for (let level = 0; level < numLevels; level++) {
        const mipDim = dim >> level;
        mipLevels.push(new Uint8Array(mipDim * mipDim * 4 * textures.length));
    }

    for (const texture of textures) {
        assert(texture.textureEntry.width === texture.textureEntry.height);
        assert(texture.textureEntry.width === dim);

        let textureData = unpalettizeTexture(texture);

        // I'd really like to read the real mip data from the game
        // If I did that I also wouldn't need to unpalettize the textures on the cpu.
        for (let level = 0; level < numLevels; level++) {
            mipLevels[level].set(textureData, ptrs[level]);
            ptrs[level] += textureData.byteLength;
            if (level < numLevels - 1) {
                textureData = downscale(textureData);
            }
        }
    }
    device.uploadTextureData(gfxTexture, 0, mipLevels);
    return gfxTexture;
}

// create a 64xN texture, where each row contains the 64-wide vertex color lookup table for one tie instance
export function createTieRgbaTexture(device: GfxDevice, tieInstances: TieInstance[]): GfxTexture {
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width: 64,
        height: tieInstances.length,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, `Tie Ambient RGBAs`);

    const data = new Uint8Array(64 * tieInstances.length * 4);
    let ptr = 0;
    for (let i = 0; i < tieInstances.length; i++) {
        const instance = tieInstances[i];
        for (let j = 0; j < 64; j++) {
            const a1bgr5 = instance.ambientRgbas[j];
            data[ptr++] = ((a1bgr5 >> 0) & 0x1F) << 3;
            data[ptr++] = ((a1bgr5 >> 5) & 0x1F) << 3;
            data[ptr++] = ((a1bgr5 >> 10) & 0x1F) << 3;
            data[ptr++] = 255;
        }
    }

    device.uploadTextureData(gfxTexture, 0, [data]);

    return gfxTexture;
}

type TexturesBySize = {
    16: PaletteTexture[],
    32: PaletteTexture[],
    64: PaletteTexture[],
    128: PaletteTexture[],
    256: PaletteTexture[],
};

function validateSize(size: number): size is 16 | 32 | 64 | 128 | 256 {
    const validSizes = [16, 32, 64, 128, 256];
    return validSizes.includes(size);
}

function assignTexturesToSizeBucket(buckets: TexturesBySize, textures: PaletteTexture[]) {
    const remap = textures.map((texture, i) => {
        const width = texture.textureEntry.width;
        assert(width === texture.textureEntry.height);
        assert(validateSize(width));
        buckets[width].push(texture);
        return {
            sizeBucket: width,
            index: buckets[width].length - 1,
        };
    });

    return remap;
}

export interface TextureAtlases {
    gfxTextures: { [size in 16 | 32 | 64 | 128 | 256]: GfxTexture },
    tfragTextureRemap: { sizeBucket: number, index: number }[],
    tieTextureRemap: { sizeBucket: number, index: number }[],
    shrubTextureRemap: { sizeBucket: number, index: number }[],
};

export function createTextureAtlases(device: GfxDevice, tfragTextures: PaletteTexture[], tieTextures: PaletteTexture[], shrubTextures: PaletteTexture[]): TextureAtlases {
    const texturesBySize: TexturesBySize = {
        16: [],
        32: [],
        64: [],
        128: [],
        256: [],
    };

    const tfragTextureRemap = assignTexturesToSizeBucket(texturesBySize, tfragTextures);
    const tieTextureRemap = assignTexturesToSizeBucket(texturesBySize, tieTextures);
    const shrubTextureRemap = assignTexturesToSizeBucket(texturesBySize, shrubTextures);

    const gfxTextures = {
        16: createGfxTextureArrayForPaletteTextures(device, '16x16 Texture Array', texturesBySize[16]),
        32: createGfxTextureArrayForPaletteTextures(device, '32x32 Texture Array', texturesBySize[32]),
        64: createGfxTextureArrayForPaletteTextures(device, '64x64 Texture Array', texturesBySize[64]),
        128: createGfxTextureArrayForPaletteTextures(device, '128x128 Texture Array', texturesBySize[128]),
        256: createGfxTextureArrayForPaletteTextures(device, '256x256 Texture Array', texturesBySize[256]),
    };

    return {
        gfxTextures,
        tfragTextureRemap,
        tieTextureRemap,
        shrubTextureRemap,
    };
}
