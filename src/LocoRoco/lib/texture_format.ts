/*
 * LocoRoco Texture Format
 *
 * Common texture format definitions and decoding logic shared between
 * BLV and TIMP texture parsing.
 *
 * petton-svn, 2026.
 */

export enum PalettePixelFormat {
  NoPalette = 0,
  RGBA8888 = 8888,
  RGB5650 = 5650,
}

export class TextureFormat {
  public paletteSize: number | null; // Null if no palette.
  public palettePixelFormat: PalettePixelFormat;
  public bitsPerPixel: number;
  public blockWidth: number;
  public blockHeight: number;
  public blockSizeBytes: number;

  constructor(
    paletteSize: number | null,
    palettePixelFormat: PalettePixelFormat,
    bitsPerPixel: number,
    blockWidth: number,
    blockHeight: number,
  ) {
    this.paletteSize = paletteSize;
    this.palettePixelFormat = palettePixelFormat;
    this.bitsPerPixel = bitsPerPixel;
    this.blockWidth = blockWidth;
    this.blockHeight = blockHeight;
    this.blockSizeBytes =
      (this.blockWidth * this.blockHeight * this.bitsPerPixel) / 8;
  }

  calcNumPaletteColours(): number {
    return this.paletteSize!;
  }

  paletteColorSize(): number {
    if (this.palettePixelFormat === PalettePixelFormat.RGB5650) {
      return 2;
    } else if (this.palettePixelFormat === PalettePixelFormat.RGBA8888) {
      return 4;
    } else {
      throw new Error("Unknown palette pixel format");
    }
  }

  calcDataSize(width: number, height: number): number {
    const roundUp = (x: number, m: number) => Math.ceil(x / m) * m;
    return (
      (roundUp(width, this.blockWidth) *
        roundUp(height, this.blockHeight) *
        this.bitsPerPixel) /
      8
    );
  }
}

/** Decode block-based texture data to RGBA8888. */
export function decodeTextureToRGBA(
  format: TextureFormat,
  data: Uint8Array,
  palette: number[] | null,
  width: number,
  height: number,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const blockX = Math.floor(x / format.blockWidth);
      const blockY = Math.floor(y / format.blockHeight);

      const blocksInRow = Math.ceil(width / format.blockWidth);
      const bytesPerRowOfBlocks = blocksInRow * format.blockSizeBytes;

      const blockStartByteOffset =
        blockY * bytesPerRowOfBlocks + blockX * format.blockSizeBytes;

      const blockOffsetX = x % format.blockWidth;
      const blockOffsetY = y % format.blockHeight;

      const pixelStartByteOffset = Math.floor(
        (blockOffsetY * format.blockWidth * format.bitsPerPixel +
          blockOffsetX * format.bitsPerPixel) /
          8,
      );

      const pixelOffset = blockStartByteOffset + pixelStartByteOffset;
      const rgbaOffset = (y * width + x) * 4;

      if (format.bitsPerPixel === 32) {
        rgba[rgbaOffset + 0] = data[pixelOffset + 0];
        rgba[rgbaOffset + 1] = data[pixelOffset + 1];
        rgba[rgbaOffset + 2] = data[pixelOffset + 2];
        rgba[rgbaOffset + 3] = data[pixelOffset + 3];
      } else {
        let index = data[pixelOffset];
        if (format.bitsPerPixel === 4) {
          if (x % 2 === 0) {
            index &= 0x0f;
          } else {
            index >>= 4;
          }
        }

        const color = palette![index] ?? 0;
        if (format.palettePixelFormat === PalettePixelFormat.RGB5650) {
          rgba[rgbaOffset + 0] = (color & 0x1f) << 3; // R: bits 0-4
          rgba[rgbaOffset + 1] = ((color >> 5) & 0x3f) << 2; // G: bits 5-10
          rgba[rgbaOffset + 2] = ((color >> 11) & 0x1f) << 3; // B: bits 11-15
          rgba[rgbaOffset + 3] = 255;
        } else {
          // RGBA8888
          rgba[rgbaOffset + 0] = (color >> 0) & 0xff;
          rgba[rgbaOffset + 1] = (color >> 8) & 0xff;
          rgba[rgbaOffset + 2] = (color >> 16) & 0xff;
          rgba[rgbaOffset + 3] = (color >> 24) & 0xff;
        }
      }
    }
  }

  return rgba;
}
