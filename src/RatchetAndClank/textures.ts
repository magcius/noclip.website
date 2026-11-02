import { Color } from "../Color";
import { DataViewExt } from "./DataViewExt";
import { GfxDevice, GfxFormat, GfxTexture, GfxTextureDimension, GfxTextureUsage, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { SkyHeader, SkyTextureEntry, TieClass } from "./bin-core";
import { TieAmbientRgbaBlock, TieInstance } from "./bin-gameplay";
import { assert } from "../util";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { FxTextureEntry, TextureEntry } from "./bin-index";
import { GN } from "./utils";

export interface PaletteTexture {
    name: string,
    textureEntry: { width: number, height: number },
    pixels: Uint8Array,
    palette: Color[],
    hasAlpha: boolean,
    unswizzled: boolean,
};

// loads a tie/shrub/tfrag/moby texture, data from the core file texture block, palette from gs ram
export function readTexture_Regular(gn: GN, textureEntry: TextureEntry, textureData: DataViewExt, gsRam: DataViewExt, ownerType: string, i: number): PaletteTexture {
    let pixels = textureData.subview(textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    if (gn == 4) pixels = unswizzleTexture(pixels, textureEntry)

    let rgbaPalette = gsRam.subview(textureEntry.palette * 0x100, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = unswizzlePalette(rgbaPalette);

    return {
        name: `${ownerType} Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
        unswizzled: false,
    };
}

// loads an fx texture from the fx bank
export function readTexture_Fx(gn: GN, textureEntry: FxTextureEntry, fxBank: DataViewExt, i: number): PaletteTexture {
    let pixels = fxBank.subview(textureEntry.dataOffsetInFxBank, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    if (gn == 4) pixels = unswizzleTexture(pixels, textureEntry)

    let rgbaPalette = fxBank.subview(textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = unswizzlePalette(rgbaPalette);

    return {
        name: `FX Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
        unswizzled: false,
    };
}

// loads sky texture from a sky texture view (of core data)
export function readTexture_Sky(gn: GN, skyView: DataViewExt, skyHeader: SkyHeader, textureEntry: SkyTextureEntry, i: number): PaletteTexture {
    let pixels = skyView.subview(skyHeader.textureData + textureEntry.dataOffset, textureEntry.width * textureEntry.height).getTypedArrayView(Uint8Array);
    if (gn == 4) pixels = unswizzleTexture(pixels, textureEntry)

    let rgbaPalette = skyView.subview(skyHeader.textureData + textureEntry.palette, 256 * 4).subdivide(0, 256, 4).map(view => view.getUint8_Rgba(0));
    rgbaPalette = unswizzlePalette(rgbaPalette);

    return {
        name: `Sky Texture ${i}`,
        textureEntry,
        pixels,
        palette: rgbaPalette,
        hasAlpha: paletteHasAlpha(pixels, rgbaPalette),
        unswizzled: false,
    };
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

// return true if any pixel is transparent
export function paletteHasAlpha(pixels: Uint8Array, palette: Color[]) {
    // we can't just check the palette because the texture might not use all the palette colors
    for (let i = 0; i < pixels.length; i++) {
        if (palette[pixels[i]].a < 0x80) {
            return true;
        }
    }
    return false;
}

// Shuffle some indices around then double all the alphas
function unswizzlePalette(palette: Color[]) {
    const newPalette: Color[] = new Array(palette.length);

    for (let i = 0; i < palette.length; i++) {
        newPalette[i] = palette[unswizzlePaletteMapIndex(i)];
    }

    return newPalette;
}

function unswizzlePaletteMapIndex(index: number) {
    return (((index & 0b00010000) >> 1) != (index & 0b00001000)) ? (index ^ 0b00011000) : index;
}

// Replaces the pixel array with an unswizzled copy. Idempotent.
export function unswizzleTexture(pixels: Uint8Array, entry: TextureEntry | FxTextureEntry | SkyTextureEntry) {
    const width = entry.width;
    const height = entry.height;
    const dbw = Math.ceil(width / 64);
    const out = new Uint8Array(pixels.length);

    let i = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // const addr = getPixelAddressPSMT8(0, dbw, x, y);
            // out[i] = pixels[addr];
            const addr2 = unswizzleMapPixelIndex(y * width + x, width);
            out[addr2] = pixels[y * width + x];
            i++;
        }
    }

    return out;
}

/* Should use getPixelAddressPSMT8 but this is different, not sure why */
function unswizzleMapPixelIndex(i: number, width: number) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/core/texture.cpp#L467
    */
    let s = Math.trunc(i / (width * 2));
    let r = 0;
    if (s % 2 === 0)
        r = s * 2;
    else
        r = (s - 1) * 2 + 1;

    let q = Math.trunc((i % (width * 2)) / 32);

    let m = i % 4;
    let n = Math.trunc(i / 4) % 4;
    let o = i % 2;
    let p = Math.trunc(i / 16) % 2;

    if (Math.trunc(s / 2) % 2 == 1)
        p = 1 - p;

    if (o == 0)
        m = (m + p) % 4;
    else
        m = ((m - p) + 4) % 4;

    let x = n + ((m + q * 4) * 4);
    let y = r + (o * 2);

    return (x % width) + (y * width);
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
function createDebugTexture(device: GfxDevice, name: string, width: number, height: number, levels: Uint8Array[]): GfxTexture {
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width,
        height,
        depthOrArrayLayers: 1,
        numLevels: levels.length,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, name);
    device.uploadTextureData(gfxTexture, 0, levels);
    return gfxTexture;
}

export function createGfxTextureArrayForPaletteTextures(device: GfxDevice, name: string, textures: PaletteTexture[], addDebugTexture: (texture: GfxTexture) => void) {
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

    for (let textureIndex = 0; textureIndex < textures.length; textureIndex++) {
        const texture = textures[textureIndex];
        assert(texture.textureEntry.width === texture.textureEntry.height);
        assert(texture.textureEntry.width === dim);

        let textureData = unpalettizeTexture(texture);
        const debugTextures: Uint8Array[] = [];

        // I'd really like to read the real mip data from the game
        // If I did that I also wouldn't need to unpalettize the textures on the cpu.
        for (let level = 0; level < numLevels; level++) {
            debugTextures.push(textureData);
            mipLevels[level].set(textureData, ptrs[level]);
            ptrs[level] += textureData.byteLength;
            if (level < numLevels - 1) {
                textureData = downscale(textureData);
            }
        }

        if (IS_DEVELOPMENT) {
            addDebugTexture(createDebugTexture(device, `${name.replace(' Texture Array', '')} L${textureIndex}`, dim, dim, debugTextures));
        }
    }
    device.uploadTextureData(gfxTexture, 0, mipLevels);
    return gfxTexture;
}

// create a 64xN texture, where each row contains the 64-wide vertex color lookup table for one tie instance
export function createTieRgbaTexture_Rac1(device: GfxDevice, tieInstances: (TieInstance | null)[], addDebugTexture: (texture: GfxTexture) => void): GfxTexture {
    if (tieInstances.length === 0) {
        return create1x1x1ErrorArrayTexture(device);
    }

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
        if (instance) {
            for (let j = 0; j < 64; j++) {
                const a1bgr5 = instance.ambientRgbas[j];
                data[ptr + 0] = ((a1bgr5 >> 0) & 0x1F) << 3;
                data[ptr + 1] = ((a1bgr5 >> 5) & 0x1F) << 3;
                data[ptr + 2] = ((a1bgr5 >> 10) & 0x1F) << 3;
                data[ptr + 3] = 255; // no alpha in this color format
                ptr += 4;
            }
        } else {
            ptr += 64 * 0x4;
        }
    }

    device.uploadTextureData(gfxTexture, 0, [data]);

    if (IS_DEVELOPMENT) {
        addDebugTexture(createDebugTexture(device, `Tie RGBA Texture`, gfxTexture.width, gfxTexture.height, [data]));
    }

    return gfxTexture;
}

export const MAGIC_GLOW_IDX = 2044;

export function createTieRgbaTexture_Rac234(device: GfxDevice, tieInstances: (TieInstance | null)[], tieClasses: Map<number, TieClass>, tieRgbasBlock: TieAmbientRgbaBlock, addDebugTexture: (texture: GfxTexture) => void): GfxTexture {
    const width = MAGIC_GLOW_IDX / 4 + 1;
    const height = tieInstances.length;
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.U8_RGBA_NORM,
        width,
        height,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, `Tie RGBA Texture`);

    const data = new Uint8Array(width * height * 4).fill(128);

    for (let rowIndex = 0; rowIndex < tieRgbasBlock.list.length; rowIndex++) {
        const row = tieRgbasBlock.list[rowIndex];
        const tieInstance = tieInstances[row.tieIndex];
        if (!tieInstance) continue;
        assert(row.tieIndex === tieInstance._i);
        const tieClass = tieClasses.get(tieInstance.oClass);
        assert(tieClass !== undefined);
        assert(row.ambientRgbas.length <= width);

        let ptr = tieInstance._i * width * 4;
        for (let colorIndex = 0; colorIndex < row.ambientRgbas.length; colorIndex++) {
            const color = row.ambientRgbas[colorIndex];
            data[ptr++] = color.r;
            data[ptr++] = color.g;
            data[ptr++] = color.b;
            data[ptr++] = 255;
        }

        // 511 means "substitute instance glow color"
        const glowColor = tieClass.header.glowRgba;
        ptr = (tieInstance._i * width + MAGIC_GLOW_IDX / 4) * 4;
        data[ptr + 0] = glowColor.r;
        data[ptr + 1] = glowColor.g;
        data[ptr + 2] = glowColor.b;
        data[ptr + 3] = glowColor.a;
    }

    device.uploadTextureData(gfxTexture, 0, [data]);

    if (IS_DEVELOPMENT) {
        addDebugTexture(createDebugTexture(device, `Tie RGBA Texture`, gfxTexture.width, gfxTexture.height, [data]));
    }

    return gfxTexture;
}

// rows are class indices, columns are normal indices
export function createTieNormalsTexture(gn: GN, device: GfxDevice, tieClasses: Map<number, TieClass>): GfxTexture {
    const classes = Array.from(tieClasses.values());
    const width = gn === 1 ? 64 : 512;
    const height = Math.max(classes.length, 1);
    const gfxTexture = device.createTexture({
        dimension: GfxTextureDimension.n2D,
        pixelFormat: GfxFormat.F32_RGBA,
        width,
        height,
        depthOrArrayLayers: 1,
        numLevels: 1,
        usage: GfxTextureUsage.Sampled,
    });
    device.setResourceName(gfxTexture, `Tie Normals Texture`);

    const data = new Float32Array(width * height * 4);
    for (let i = 0; i < classes.length; i++) {
        const { _classIndex, normalsData } = classes[i];
        assert(normalsData.length <= width);
        for (let j = 0; j < normalsData.length; j++) {
            const ptr = (_classIndex * width + j) * 4;
            data[ptr + 0] = normalsData[j].x;
            data[ptr + 1] = normalsData[j].y;
            data[ptr + 2] = normalsData[j].z;
            data[ptr + 3] = normalsData[j].w;
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


export function packRemap(remap: { sizeBucket: number, index: number }) {
    const bucket = remap ? Math.log2(remap.sizeBucket) - 4 : 0;
    const slice = remap ? remap.index : 0;
    return (slice << 3) | (bucket & 0x07);
};

export interface TextureAtlases {
    gfxTextures: { [size in 16 | 32 | 64 | 128 | 256]: GfxTexture },
    tfragTextureRemap: { sizeBucket: number, index: number }[],
    tieTextureRemap: { sizeBucket: number, index: number }[],
    mobyTextureRemap: { sizeBucket: number, index: number }[],
    shrubTextureRemap: { sizeBucket: number, index: number }[],
};

export function createTextureAtlases(device: GfxDevice, tfragTextures: PaletteTexture[], tieTextures: PaletteTexture[], mobyTextures: PaletteTexture[], shrubTextures: PaletteTexture[], addDebugTexture: (texture: GfxTexture) => void): TextureAtlases {
    const texturesBySize: TexturesBySize = {
        16: [],
        32: [],
        64: [],
        128: [],
        256: [],
    };

    const tfragTextureRemap = assignTexturesToSizeBucket(texturesBySize, tfragTextures);
    const tieTextureRemap = assignTexturesToSizeBucket(texturesBySize, tieTextures);
    const mobyTextureRemap = assignTexturesToSizeBucket(texturesBySize, mobyTextures);
    const shrubTextureRemap = assignTexturesToSizeBucket(texturesBySize, shrubTextures);

    const gfxTextures = {
        16: createGfxTextureArrayForPaletteTextures(device, '16x16 Texture Array', texturesBySize[16], addDebugTexture),
        32: createGfxTextureArrayForPaletteTextures(device, '32x32 Texture Array', texturesBySize[32], addDebugTexture),
        64: createGfxTextureArrayForPaletteTextures(device, '64x64 Texture Array', texturesBySize[64], addDebugTexture),
        128: createGfxTextureArrayForPaletteTextures(device, '128x128 Texture Array', texturesBySize[128], addDebugTexture),
        256: createGfxTextureArrayForPaletteTextures(device, '256x256 Texture Array', texturesBySize[256], addDebugTexture),
    };

    return {
        gfxTextures,
        tfragTextureRemap,
        tieTextureRemap,
        mobyTextureRemap,
        shrubTextureRemap,
    };
}
