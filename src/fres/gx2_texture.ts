
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode } from './gx2_enum';

interface DecodedTextureR {
    type: 'R';
    flag: 'UNORM' | 'SNORM';
    bytesPerPixel: 1;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureRG {
    type: 'RG';
    flag: 'UNORM' | 'SNORM';
    bytesPerPixel: 2;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureRGBA {
    type: 'RGBA';
    flag: 'UNORM' | 'SRGB';
    bytesPerPixel: 4;
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureBC13 {
    type: 'BC1' | 'BC3';
    flag: 'UNORM' | 'SRGB';
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

interface DecodedTextureBC45 {
    type: 'BC4' | 'BC5';
    flag: 'UNORM' | 'SNORM';
    pixels: ArrayBuffer;
    width: number;
    height: number;
}

export type DecodedTextureBC = DecodedTextureBC13 | DecodedTextureBC45;
export type DecodedTexture = DecodedTextureR | DecodedTextureRG | DecodedTextureRGBA | DecodedTextureBC;

interface GX2Surface {
    format: GX2SurfaceFormat;
    tileMode: GX2TileMode;
    aaMode: GX2AAMode;
    swizzle: number;
    width: number;
    height: number;
    depth: number;
    pitch: number;

    texDataSize: number;
    mipDataSize: number;
}

export function parseGX2Surface(buffer: ArrayBuffer, gx2SurfaceOffs: number): GX2Surface {
    const view = new DataView(buffer.slice(gx2SurfaceOffs, gx2SurfaceOffs + 0x9C));

    const dimension = view.getUint32(0x00, false);
    const width = view.getUint32(0x04, false);
    const height = view.getUint32(0x08, false);
    const depth = view.getUint32(0x0C, false);
    const numMips = view.getUint32(0x10, false);
    const format = view.getUint32(0x14, false);
    const aaMode = view.getUint32(0x18, false);

    const texDataSize = view.getUint32(0x20, false);
    const mipDataSize = view.getUint32(0x28, false);
    const tileMode = view.getUint32(0x30, false);
    const swizzle = view.getUint32(0x34, false);
    const align = view.getUint32(0x38, false);
    const pitch = view.getUint32(0x3C, false);

    let mipDataOffsetTableIdx = 0x40;
    const mipDataOffsets = [];
    for (let i = 0; i < 13; i++) {
        mipDataOffsets.push(view.getUint32(mipDataOffsetTableIdx, false));
        mipDataOffsetTableIdx += 0x04;
    }

    const surface = { format, tileMode, swizzle, width, height, depth, pitch, aaMode, texDataSize, mipDataSize };
    return surface;
}

function memcpy(dst: Uint8Array, dstOffs: number, src: ArrayBuffer, srcOffs: number, length: number) {
    dst.set(new Uint8Array(src, srcOffs, length), dstOffs);
}

// #region Swizzle
const numPipes = 2;
const numBanks = 4;
const microTileWidth = 8;
const microTileHeight = 8
const microTilePixels = microTileWidth * microTileHeight;

function computePipeFromCoordWoRotation(x, y) {
    // NumPipes = 2
    const x3 = (x >>> 3) & 1;
    const y3 = (y >>> 3) & 1;
    const pipeBit0 = (y3 ^ x3);
    return (pipeBit0 << 0);
}

function computeBankFromCoordWoRotation(x, y) {
    const ty = (y / numPipes) | 0;

    const x3 = (x >>> 3) & 1;
    const x4 = (x >>> 4) & 1;
    const ty3 = (ty >>> 3) & 1;
    const ty4 = (ty >>> 4) & 1;

    const p0 = ty4 ^ x3;
    const p1 = ty3 ^ x4;
    return (p1 << 1) | (p0 << 0);
}

function computeSurfaceThickness(tileMode: GX2TileMode) {
    switch (tileMode) {
    case GX2TileMode._1D_TILED_THIN1:
    case GX2TileMode._2D_TILED_THIN1:
        return 1;
    }
}

function computeSurfaceBlockWidth(format: GX2SurfaceFormat) {
    switch (format & GX2SurfaceFormat.FMT_MASK) {
    case GX2SurfaceFormat.FMT_BC1:
    case GX2SurfaceFormat.FMT_BC3:
    case GX2SurfaceFormat.FMT_BC4:
    case GX2SurfaceFormat.FMT_BC5:
        return 4;
    default:
        return 1;
    }
}

function computeSurfaceBytesPerBlock(format: GX2SurfaceFormat) {
    switch (format & GX2SurfaceFormat.FMT_MASK) {
    case GX2SurfaceFormat.FMT_BC1:
    case GX2SurfaceFormat.FMT_BC4:
        return 8;
    case GX2SurfaceFormat.FMT_BC3:
    case GX2SurfaceFormat.FMT_BC5:
        return 16;

    // For non-block formats, a "block" is a pixel.
    case GX2SurfaceFormat.FMT_TCS_R8_G8_B8_A8:
        return 4;
    }
}

function computePixelIndexWithinMicroTile(x, y, bytesPerBlock) {
    const x0 = (x >>> 0) & 1;
    const x1 = (x >>> 1) & 1;
    const x2 = (x >>> 2) & 1;
    const y0 = (y >>> 0) & 1;
    const y1 = (y >>> 1) & 1;
    const y2 = (y >>> 2) & 1;

    let pixelBits;
    if (bytesPerBlock === 8) {
        pixelBits = [y2, y1, x2, x1, y0, x0];
    } else if (bytesPerBlock === 16) {
        pixelBits = [y2, y1, x2, x1, x0, y0];
    } else if (bytesPerBlock === 4) {
        pixelBits = [y2, y1, y0, x2, x1, x0];
    } else {
        throw new Error("Invalid bpp");
    }

    const p5 = pixelBits[0];
    const p4 = pixelBits[1];
    const p3 = pixelBits[2];
    const p2 = pixelBits[3];
    const p1 = pixelBits[4];
    const p0 = pixelBits[5];
    return (p5 << 5) | (p4 << 4) | (p3 << 3) | (p2 << 2) | (p1 << 1) | (p0 << 0);
}

function computeSurfaceRotationFromTileMode(tileMode: GX2TileMode) {
    switch (tileMode) {
    case GX2TileMode._2D_TILED_THIN1:
        return numPipes * ((numBanks >> 1) - 1);
    }
}

function computeTileModeAspectRatio(tileMode: GX2TileMode) {
    switch (tileMode) {
    case GX2TileMode._2D_TILED_THIN1:
        return 1;
    }
}

function computeMacroTilePitch(tileMode: GX2TileMode) {
    return (8 * numBanks) / computeTileModeAspectRatio(tileMode);
}

function computeMacroTileHeight(tileMode: GX2TileMode) {
    return (8 * numPipes) / computeTileModeAspectRatio(tileMode);
}

function computeSurfaceAddrFromCoordMicroTiled(x, y, surface: GX2Surface) {
    // XXX(jstpierre): 3D Textures
    const slice = 0;

    const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
    const microTileThickness = computeSurfaceThickness(surface.tileMode);
    const microTileBytes = bytesPerBlock * microTileThickness * microTilePixels;
    const microTilesPerRow = surface.pitch / microTileWidth;
    const microTileIndexX = (x / microTileWidth) | 0;
    const microTileIndexY = (y / microTileHeight) | 0;
    const microTileIndexZ = (slice / microTileThickness) | 0;

    const microTileOffset = microTileBytes * (microTileIndexX + microTileIndexY * microTilesPerRow);
    const sliceBytes = surface.pitch * surface.height * microTileThickness * bytesPerBlock;
    const sliceOffset = microTileIndexZ * sliceBytes;
    const pixelIndex = computePixelIndexWithinMicroTile(x, y, bytesPerBlock);
    const pixelOffset = bytesPerBlock * pixelIndex;

    return pixelOffset + microTileOffset + sliceOffset;
}

function computeSurfaceAddrFromCoordMacroTiled(x, y, surface: GX2Surface) {
    // XXX(jstpierre): AA textures
    const sample = 0;
    // XXX(jstpierre): 3D Textures
    const slice = 0;

    const numSamples = 1 << surface.aaMode;
    const pipeSwizzle = (surface.swizzle >> 8) & 0x01;
    const bankSwizzle = (surface.swizzle >> 9) & 0x03;

    const pipeInterleaveBytes = 256;
    const numPipeBits = 1;
    const numBankBits = 2;
    const numGroupBits = 8;
    const rowSize = 2048;
    const swapSize = 256;
    const splitSize = 2048;

    const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
    const microTileThickness = computeSurfaceThickness(surface.tileMode);
    const bytesPerSample = bytesPerBlock * microTileThickness * microTilePixels;
    const microTileBytes = bytesPerSample * numSamples;
    const isSamplesSplit = numSamples > 1 && (microTileBytes > splitSize);
    const samplesPerSlice = Math.max(isSamplesSplit ? (splitSize / bytesPerSample) : numSamples, 1);
    const numSampleSplits = isSamplesSplit ? (numSamples / samplesPerSlice) : 1;
    const numSurfaceSamples = isSamplesSplit ? samplesPerSlice : numSamples;

    const rotation = computeSurfaceRotationFromTileMode(surface.tileMode);
    const macroTilePitch = computeMacroTilePitch(surface.tileMode);
    const macroTileHeight = computeMacroTileHeight(surface.tileMode);
    const groupMask = (1 << numGroupBits) - 1;

    const pixelIndex = computePixelIndexWithinMicroTile(x, y, bytesPerBlock);
    const pixelOffset = pixelIndex * bytesPerBlock;
    const sampleOffset = sample * (microTileBytes / numSamples);

    let elemOffset = pixelOffset + sampleOffset;
    let sampleSlice;
    if (isSamplesSplit) {
        const tileSliceBytes = microTileBytes / numSampleSplits;
        sampleSlice = (elemOffset / tileSliceBytes) | 0;
        elemOffset = elemOffset % tileSliceBytes;
    } else {
        sampleSlice = 0;
    }

    const pipe1 = computePipeFromCoordWoRotation(x, y);
    const bank1 = computeBankFromCoordWoRotation(x, y);
    let bankPipe = pipe1 + numPipes * bank1;
    const sliceIn = slice / (microTileThickness > 1 ? 4 : 1);
    const swizzle = pipeSwizzle + numPipes * bankSwizzle;
    bankPipe = bankPipe ^ (numPipes * sampleSlice * ((numBanks >> 1) + 1) ^ (swizzle + sliceIn * rotation));
    bankPipe = bankPipe % (numPipes * numBanks);
    const pipe = (bankPipe % numPipes) | 0;
    const bank = (bankPipe / numPipes) | 0;

    const sliceBytes = surface.height * surface.pitch * microTileThickness * bytesPerBlock * numSamples;
    const sliceOffset = sliceBytes * ((sampleSlice / microTileThickness) | 0);

    const numSwizzleBits = numBankBits + numPipeBits;

    const macroTilesPerRow = (surface.pitch / macroTilePitch) | 0;
    const macroTileBytes = (numSamples * microTileThickness * bytesPerBlock * macroTileHeight * macroTilePitch);
    const macroTileIndexX = (x / macroTilePitch) | 0;
    const macroTileIndexY = (y / macroTileHeight) | 0;
    const macroTileOffset = (macroTileIndexX + macroTilesPerRow * macroTileIndexY) * macroTileBytes;

    const totalOffset = (elemOffset + ((macroTileOffset + sliceOffset) >> numSwizzleBits));

    const offsetHigh = (totalOffset & ~groupMask) << numSwizzleBits;
    const offsetLow =  (totalOffset & groupMask);

    const pipeBits = pipe << (numGroupBits);
    const bankBits = bank << (numPipeBits + numGroupBits);
    const addr = (bankBits | pipeBits | offsetLow | offsetHigh);

    return addr;
}

function deswizzle(surface: GX2Surface, srcBuffer: ArrayBuffer): ArrayBuffer {
    // For non-BC formats, "block" = 1 pixel.
    const blockSize = computeSurfaceBlockWidth(surface.format);

    let widthBlocks = ((surface.width + blockSize - 1) / blockSize) | 0;
    let heightBlocks = ((surface.height + blockSize - 1) / blockSize) | 0;

    const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
    const dst = new Uint8Array(widthBlocks * heightBlocks * bytesPerBlock);

    for (let y = 0; y < heightBlocks; y++) {
        for (let x = 0; x < widthBlocks; x++) {
            let srcIdx;
            switch (surface.tileMode) {
            case GX2TileMode._1D_TILED_THIN1:
                srcIdx = computeSurfaceAddrFromCoordMicroTiled(x, y, surface);
                break;
            case GX2TileMode._2D_TILED_THIN1:
                srcIdx = computeSurfaceAddrFromCoordMacroTiled(x, y, surface);
                break;
            default:
                const tileMode_: GX2TileMode = (<GX2TileMode> surface.tileMode);
                throw new Error(`Unsupported tile mode ${tileMode_.toString(16)}`);
            }

            const dstIdx = (y * widthBlocks + x) * bytesPerBlock;
            memcpy(dst, dstIdx, srcBuffer, srcIdx, bytesPerBlock);
        }
    }

    return dst.buffer;
}

// #endregion

// #region Texture Decode
function expand5to8(n: number): number {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function expand6to8(n: number): number {
    return (n << (8 - 6)) | (n >>> (12 - 8));
}

// Use the fast GX approximation.
function s3tcblend(a: number, b: number): number {
    // return (a*3 + b*5) / 8;
    return (((a << 1) + a) + ((b << 2) + b)) >>> 3;
}

// Software decompresses from standard BC1 (DXT1) to RGBA.
function decompressBC1(texture: DecodedTextureBC13): DecodedTextureRGBA {
    const type = 'RGBA';
    const bytesPerPixel = 4;
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(texture.pixels);
    const colorTable = new Uint8Array(16);

    let srcOffs = 0;
    for (let yy = 0; yy < texture.height; yy += 4) {
        for (let xx = 0; xx < texture.width; xx += 4) {
            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);

            // Fill in first two colors in color table.
            // TODO(jstpierre): SRGB-correct blending.
            colorTable[0] = expand5to8((color1 >> 11) & 0x1F);
            colorTable[1] = expand6to8((color1 >> 5) & 0x3F);
            colorTable[2] = expand5to8(color1 & 0x1F);
            colorTable[3] = 0xFF;

            colorTable[4] = expand5to8((color2 >> 11) & 0x1F);
            colorTable[5] = expand6to8((color2 >> 5) & 0x3F);
            colorTable[6] = expand5to8(color2 & 0x1F);
            colorTable[7] = 0xFF;

            if (color1 > color2) {
                // Predict gradients.
                colorTable[8]  = s3tcblend(colorTable[4], colorTable[0]);
                colorTable[9]  = s3tcblend(colorTable[5], colorTable[1]);
                colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                colorTable[11] = 0xFF;

                colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                colorTable[15] = 0xFF;
            } else {
                colorTable[8]  = (colorTable[0] + colorTable[4]) >>> 1;
                colorTable[9]  = (colorTable[1] + colorTable[5]) >>> 1;
                colorTable[10] = (colorTable[2] + colorTable[6]) >>> 1;
                colorTable[11] = 0xFF;

                colorTable[12] = 0x00;
                colorTable[13] = 0x00;
                colorTable[14] = 0x00;
                colorTable[15] = 0x00;
            }

            let bits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstPx = (yy + y) * texture.width + xx + x;
                    const dstOffs = dstPx * 4;
                    const colorIdx = bits & 0x03;
                    dst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    dst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    dst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    dst[dstOffs + 3] = colorTable[colorIdx * 4 + 3];
                    bits >>= 2;
                }
            }

            srcOffs += 0x08;
        }
    }

    const pixels = dst.buffer;
    return { type, bytesPerPixel, flag, width, height, pixels };
}

// Software decompresses from standard BC3 (DXT5) to RGBA.
function decompressBC3(texture: DecodedTextureBC13): DecodedTextureRGBA {
    const type = 'RGBA';
    const bytesPerPixel = 4;
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const dst = new Uint8Array(width * height * bytesPerPixel);
    const view = new DataView(texture.pixels);
    const colorTable = new Uint8Array(16);
    const alphaTable = new Uint8Array(8);

    let srcOffs = 0;
    for (let yy = 0; yy < texture.height; yy += 4) {
        for (let xx = 0; xx < texture.width; xx += 4) {

            const alpha1 = view.getUint8(srcOffs + 0x00);
            const alpha2 = view.getUint8(srcOffs + 0x01);

            alphaTable[0] = alpha1;
            alphaTable[1] = alpha2;
            if (alpha1 > alpha2) {
                alphaTable[2] = (6 * alpha1 + 1 * alpha2) / 7;
                alphaTable[3] = (5 * alpha1 + 2 * alpha2) / 7;
                alphaTable[4] = (4 * alpha1 + 3 * alpha2) / 7;
                alphaTable[5] = (3 * alpha1 + 4 * alpha2) / 7;
                alphaTable[6] = (2 * alpha1 + 5 * alpha2) / 7;
                alphaTable[7] = (1 * alpha1 + 6 * alpha2) / 7;
            } else {
                alphaTable[2] = (4 * alpha1 + 1 * alpha2) / 5;
                alphaTable[3] = (3 * alpha1 + 2 * alpha2) / 5;
                alphaTable[4] = (2 * alpha1 + 3 * alpha2) / 5;
                alphaTable[5] = (1 * alpha1 + 4 * alpha2) / 5;
                alphaTable[6] = 0;
                alphaTable[7] = 255;
            }

            const alphaBits0 = view.getUint32(srcOffs + 0x02, true) & 0x00FFFFFF;
            const alphaBits1 = view.getUint32(srcOffs + 0x04, true) >>> 8;
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstIdx = ((yy + y) * width) + xx + x;
                    const dstOffs = (dstIdx * bytesPerPixel);
                    const fullShift = (y * 4 + x) * 3;
                    const alphaBits = fullShift < 24 ? alphaBits0 : alphaBits1;
                    const shift = fullShift % 24;
                    const index = (alphaBits >>> shift) & 0x07;
                    dst[dstOffs + 3] = alphaTable[index];
                }
            }

            srcOffs += 0x08;

            const color1 = view.getUint16(srcOffs + 0x00, true);
            const color2 = view.getUint16(srcOffs + 0x02, true);

            // Fill in first two colors in color table.
            // TODO(jstpierre): SRGB-correct blending.
            colorTable[0] = expand5to8((color1 >> 11) & 0x1F);
            colorTable[1] = expand6to8((color1 >> 5) & 0x3F);
            colorTable[2] = expand5to8(color1 & 0x1F);
            colorTable[3] = 0xFF;

            colorTable[4] = expand5to8((color2 >> 11) & 0x1F);
            colorTable[5] = expand6to8((color2 >> 5) & 0x3F);
            colorTable[6] = expand5to8(color2 & 0x1F);
            colorTable[7] = 0xFF;

            if (color1 > color2) {
                // Predict gradients.
                colorTable[8]  = s3tcblend(colorTable[4], colorTable[0]);
                colorTable[9]  = s3tcblend(colorTable[5], colorTable[1]);
                colorTable[10] = s3tcblend(colorTable[6], colorTable[2]);
                colorTable[11] = 0xFF;

                colorTable[12] = s3tcblend(colorTable[0], colorTable[4]);
                colorTable[13] = s3tcblend(colorTable[1], colorTable[5]);
                colorTable[14] = s3tcblend(colorTable[2], colorTable[6]);
                colorTable[15] = 0xFF;
            } else {
                colorTable[8]  = (colorTable[0] + colorTable[4]) >>> 1;
                colorTable[9]  = (colorTable[1] + colorTable[5]) >>> 1;
                colorTable[10] = (colorTable[2] + colorTable[6]) >>> 1;
                colorTable[11] = 0xFF;

                colorTable[12] = 0x00;
                colorTable[13] = 0x00;
                colorTable[14] = 0x00;
                colorTable[15] = 0xFF;
            }

            let colorBits = view.getUint32(srcOffs + 0x04, true);
            for (let y = 0; y < 4; y++) {
                for (let x = 0; x < 4; x++) {
                    const dstIdx = (yy + y) * texture.width + xx + x;
                    const dstOffs = (dstIdx * bytesPerPixel);
                    const colorIdx = colorBits & 0x03;
                    dst[dstOffs + 0] = colorTable[colorIdx * 4 + 0];
                    dst[dstOffs + 1] = colorTable[colorIdx * 4 + 1];
                    dst[dstOffs + 2] = colorTable[colorIdx * 4 + 2];
                    colorBits >>= 2;
                }
            }

            srcOffs += 0x08;
        }
    }

    const pixels = dst.buffer;
    return { type, bytesPerPixel, flag, width, height, pixels };
}

// Software decompresses from standard BC4/BC5 to R/RG.
function decompressBC45(texture: DecodedTextureBC45): DecodedTexture {
    let bytesPerPixel, type;
    switch (texture.type) {
    case 'BC4':
        type = 'R';
        bytesPerPixel = 1;
        break;
    case 'BC5':
        type = 'RG';
        bytesPerPixel = 2;
        break;
    }

    const signed = texture.flag === 'SNORM';
    const flag = texture.flag;
    const width = texture.width;
    const height = texture.height;
    const view = new DataView(texture.pixels);
    let dst;
    let colorTable;

    if (signed) {
        dst = new Int8Array(width * height * bytesPerPixel);
        colorTable = new Int8Array(8);
    } else {
        dst = new Uint8Array(width * height * bytesPerPixel);
        colorTable = new Uint8Array(8);
    }

    let srcOffs = 0;
    for (let yy = 0; yy < height; yy += 4) {
        for (let xx = 0; xx < width; xx += 4) {
            for (let ch = 0; ch < bytesPerPixel; ch++) {
                let red0;
                let red1;
                if (signed) {
                    red0 = view.getInt8(srcOffs + 0x00);
                    red1 = view.getInt8(srcOffs + 0x01);
                } else {
                    red0 = view.getUint8(srcOffs + 0x00);
                    red1 = view.getUint8(srcOffs + 0x01);
                }

                colorTable[0] = red0;
                colorTable[1] = red1;
                if (red0 > red1) {
                    colorTable[2] = (6 * red0 + 1 * red1) / 7;
                    colorTable[3] = (5 * red0 + 2 * red1) / 7;
                    colorTable[4] = (4 * red0 + 3 * red1) / 7;
                    colorTable[5] = (3 * red0 + 4 * red1) / 7;
                    colorTable[6] = (2 * red0 + 5 * red1) / 7;
                    colorTable[7] = (1 * red0 + 6 * red1) / 7;
                } else {
                    colorTable[2] = (4 * red0 + 1 * red1) / 5;
                    colorTable[3] = (3 * red0 + 2 * red1) / 5;
                    colorTable[4] = (2 * red0 + 3 * red1) / 5;
                    colorTable[5] = (1 * red0 + 4 * red1) / 5;
                    colorTable[6] = signed ? -127 : 0;
                    colorTable[7] = signed ? 128 : 255;
                }

                const colorBits0 = view.getUint32(srcOffs + 0x02, true) & 0x00FFFFFF;
                const colorBits1 = view.getUint32(srcOffs + 0x04, true) >>> 8;
                for (let y = 0; y < 4; y++) {
                    for (let x = 0; x < 4; x++) {
                        const dstIdx = ((yy + y) * width) + xx + x;
                        const dstOffs = (dstIdx * bytesPerPixel) + ch;
                        const fullShift = (y * 4 + x) * 3;
                        const colorBits = fullShift < 24 ? colorBits0 : colorBits1;
                        const shift = fullShift % 24;
                        const index = (colorBits >>> shift) & 0x07;
                        dst[dstOffs] = colorTable[index];
                    }
                }

                srcOffs += 0x08;
            }
        }
    }

    const pixels = dst.buffer;
    return { type, flag, bytesPerPixel, width, height, pixels };
}

export function decompressBC(texture: DecodedTextureBC): DecodedTexture {
    switch (texture.type) {
    case 'BC1':
        return decompressBC1(texture);
    case 'BC3':
        return decompressBC3(texture);
    case 'BC4':
    case 'BC5':
        return decompressBC45(texture);
    }
}

export function decodeSurface(surface: GX2Surface, buffer: ArrayBuffer,
                              texDataOffs: number, mipDataOffs: number): DecodedTexture {
    const texData = buffer.slice(texDataOffs, texDataOffs + surface.texDataSize);
    const pixels = deswizzle(surface, texData);
    const width = surface.width;
    const height = surface.height;

    switch (surface.format) {
    case GX2SurfaceFormat.BC1_UNORM:
        return { type: 'BC1', flag: 'UNORM', width, height, pixels };
    case GX2SurfaceFormat.BC1_SRGB:
        return { type: 'BC1', flag: 'SRGB', width, height, pixels };
    case GX2SurfaceFormat.BC3_UNORM:
        return { type: 'BC3', flag: 'UNORM', width, height, pixels };
    case GX2SurfaceFormat.BC3_SRGB:
        return { type: 'BC3', flag: 'SRGB', width, height, pixels };
    case GX2SurfaceFormat.BC4_UNORM:
        return { type: 'BC4', flag: 'UNORM', width, height, pixels };
    case GX2SurfaceFormat.BC4_SNORM:
        return { type: 'BC4', flag: 'SNORM', width, height, pixels };
    case GX2SurfaceFormat.BC5_UNORM:
        return { type: 'BC5', flag: 'UNORM', width, height, pixels };
    case GX2SurfaceFormat.BC5_SNORM:
        return { type: 'BC5', flag: 'SNORM', width, height, pixels };
    case GX2SurfaceFormat.TCS_R8_G8_B8_A8_UNORM:
        return { type: 'RGBA', flag: 'UNORM', bytesPerPixel: 4, width, height, pixels };
    case GX2SurfaceFormat.TCS_R8_G8_B8_A8_SRGB:
        return { type: 'RGBA', flag: 'SRGB', bytesPerPixel: 4, width, height, pixels };
    default:
        throw new Error(`Bad format in decodeSurface: ${surface.format.toString(16)}`);
    }
}

export function textureToCanvas(texture: DecodedTexture): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = texture.width;
    canvas.height = texture.height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(texture.width, texture.height);

    // Decompress BC if we have it.
    switch (texture.type) {
    case 'BC1':
    case 'BC3':
    case 'BC4':
    case 'BC5':
        texture = decompressBC(texture);
        break;
    }

    switch (texture.type) {
    case 'R':
        if (texture.flag === 'UNORM') {
            const src = new Uint8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i];
                imageData.data[i * 4 + 1] = src[i];
                imageData.data[i * 4 + 2] = src[i];
                imageData.data[i * 4 + 3] = 0xFF;
            }
        } else {
            const src = new Int8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i] + 128;
                imageData.data[i * 4 + 1] = src[i] + 128;
                imageData.data[i * 4 + 2] = src[i] + 128;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        }
        break;
    case 'RG': {
        if (texture.flag === 'UNORM') {
            const src = new Uint8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i * 2 + 0];
                imageData.data[i * 4 + 1] = src[i * 2 + 1];
                imageData.data[i * 4 + 2] = 0xFF;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        } else {
            const src = new Int8Array(texture.pixels);
            for (let i = 0; i < texture.width * texture.height; i++) {
                imageData.data[i * 4 + 0] = src[i * 2 + 0] + 128;
                imageData.data[i * 4 + 1] = src[i * 2 + 1] + 128;
                imageData.data[i * 4 + 2] = 0xFF;
                imageData.data[i * 4 + 3] = 0xFF;
            }
        }
        break;
    }
    case 'RGBA':
        const src = new Uint8Array(texture.pixels);
        imageData.data.set(src);
        break;
    default:
        throw new Error(`Unsupported texture type in textureToCanvas ${texture.type}`);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}
// #endregion
