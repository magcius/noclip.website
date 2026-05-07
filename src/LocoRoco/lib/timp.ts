/*
 * LocoRoco TIMP (Texture) File Parser.
 *
 * petton-svn, 2026.
 */

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readString } from "../../util.js";
import {
  TextureFormat,
  PalettePixelFormat,
  decodeTextureToRGBA,
} from "./texture_format.js";

const TIMP_MAGIC = "TIMP";

const TIMP_FORMAT_030B = new TextureFormat(
  null,
  PalettePixelFormat.RGBA8888,
  32,
  4,
  8,
);
const TIMP_FORMAT_0503 = new TextureFormat(
  256,
  PalettePixelFormat.RGBA8888,
  8,
  16,
  8,
);
const TIMP_FORMAT_0403 = new TextureFormat(
  16,
  PalettePixelFormat.RGBA8888,
  4,
  32,
  8,
);

export interface TimpImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function parseTimp(buffer: ArrayBufferSlice): TimpImage {
  const view = buffer.createDataView();
  let offset = 0;

  // Check magic
  const magic = readString(buffer, offset, 4);
  if (magic !== TIMP_MAGIC) {
    throw new Error("TIMP magic incorrect");
  }
  offset += 4;

  // Skip unk_group_1 (12 bytes: HHHHI = 2+2+2+2+4)
  offset += 12;

  const unk1 = view.getUint16(offset, true);
  offset += 2;
  const width = view.getUint16(offset, true);
  offset += 2;
  const height = view.getUint16(offset, true);
  offset += 2;
  const numberOfPalettes = view.getUint16(offset, true);
  offset += 2;
  const formatSpecifier = view.getUint16(offset, true);
  offset += 2;
  const unk2 = view.getUint16(offset, true);
  offset += 2;

  let textureFormat: TextureFormat;
  if (formatSpecifier === 0x0503) {
    textureFormat = TIMP_FORMAT_0503;
  } else if (formatSpecifier === 0x0403) {
    textureFormat = TIMP_FORMAT_0403;
  } else if (formatSpecifier === 0x030b) {
    textureFormat = TIMP_FORMAT_030B;
  } else {
    throw new Error(`Unknown TIMP format: 0x${formatSpecifier.toString(16)}`);
  }

  // Skip unk_group_2 (4 bytes)
  offset += 4;

  const paletteDataStartOffset = view.getUint32(offset, true);
  offset += 4;
  const imageDataStartOffset = view.getUint32(offset, true);
  offset += 4;

  // Skip padding (8 bytes)
  offset += 8;

  // Read palette if present
  let palette: number[] | null = null;
  if (numberOfPalettes > 0 && textureFormat.paletteSize !== null) {
    palette = [];
    const numColors = Math.min(
      textureFormat.paletteSize,
      (imageDataStartOffset - offset) / 4,
    );
    for (let i = 0; i < numColors; i++) {
      palette.push(view.getUint32(offset, true));
      offset += 4;
    }
  }

  // Seek to image data
  offset = imageDataStartOffset;

  // Read image data
  const dataSize = textureFormat.calcDataSize(width, height);
  const imageData = new Uint8Array(
    buffer.arrayBuffer,
    buffer.byteOffset + offset,
    dataSize,
  );

  // Decode to RGBA
  const rgba = decodeTextureToRGBA(
    textureFormat,
    imageData,
    palette,
    width,
    height,
  );

  return { width, height, rgba };
}
