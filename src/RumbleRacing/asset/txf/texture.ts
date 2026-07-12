import {
  GSCLUTPixelStorageFormat,
  GSPixelStorageFormat,
} from "../../../Common/PS2/GS";
import { TXF } from "./TXF";
import { CLHEEntry } from "./CLHE";
import { ZTHETexture } from "./ZTHE";
import {
  groupBytesIntoChunks,
  swizzleClutPstm8,
  swizzleClutPstm4_16,
  PixelBytes,
} from "../../helpers/pstm8";

export interface RGBAImage {
  pix: Uint8Array;
  width: number;
  height: number;
}

export interface TextureFile {
  isMipMap: boolean;
  height: number;
  width: number;
  image: RGBAImage;
}

export interface Texture {
  name: string;
  textureId: number;
  files: TextureFile[];
}

function extract32bitRGBA(px: PixelBytes): [number, number, number, number] {
  const b = px.bytes;
  const R = b[0];
  const G = b[1];
  const B = b[2];
  const A = Math.round((b[3] / 128.0) * 255);
  return [R, G, B, A];
}

function extract16bitRGBA(px: PixelBytes): [number, number, number, number] {
  const word = (px.bytes[1] << 8) | px.bytes[0];
  const r5 = word & 0x1f;
  const g5 = (word >> 5) & 0x1f;
  const b5 = (word >> 10) & 0x1f;
  const R = Math.round((r5 * 255) / 31);
  const G = Math.round((g5 * 255) / 31);
  const B = Math.round((b5 * 255) / 31);
  const A = R === 0 && G === 0 && B === 0 ? 0 : 255;
  return [R, G, B, A];
}

export function extractTexturesFromZTHE(
  txf: TXF,
  clutHeader: CLHEEntry,
  zthe: ZTHETexture,
): Texture[] {
  const mipMaps: TextureFile[] = [];

  const paletteStart = clutHeader.cldaStartOffset;

  for (let k = 0; k < zthe.images.length; k++) {
    const txImage = zthe.images[k];

    let paletteSize: number;
    switch (zthe.texelStorageFormat) {
      case GSPixelStorageFormat.PSMT8:
        paletteSize = 256;
        break;
      case GSPixelStorageFormat.PSMT4:
        paletteSize = 16;
        break;
      default:
        throw new Error("Unhandled indexed texel format!");
    }

    let pixelBytes: number;
    switch (clutHeader.pixelFormat) {
      case GSCLUTPixelStorageFormat.PSMCT32:
        pixelBytes = 4;
        paletteSize *= 4;
        break;
      case GSCLUTPixelStorageFormat.PSMCT16:
        pixelBytes = 2;
        paletteSize *= 2;
        break;
      default:
        throw new Error("Unhandled clut size!");
    }

    const paletteDataUnswizzled = txf.clutData.rawData.slice(
      paletteStart,
      paletteStart + paletteSize,
    );
    const grouped = groupBytesIntoChunks(paletteDataUnswizzled, pixelBytes);

    let swizzled: PixelBytes[];
    switch (zthe.texelStorageFormat) {
      case GSPixelStorageFormat.PSMT8:
        swizzled = swizzleClutPstm8(grouped);
        break;
      case GSPixelStorageFormat.PSMT4:
        swizzled = swizzleClutPstm4_16(grouped);
        break;
      default:
        throw new Error("unhandled!");
    }

    const height = txImage.blockHeightPixels;
    const width = zthe.blockWidthPixels >> k;

    const size = height * width;
    let colorSize = size;
    switch (zthe.texelStorageFormat) {
      case GSPixelStorageFormat.PSMT8:
        break;
      case GSPixelStorageFormat.PSMT4:
        colorSize = Math.floor(size / 2);
        break;
      default:
        throw new Error("Something went wrong!");
    }

    const start = txImage.txdaAddressOffset;
    if (start + colorSize > txf.textureData.rawData.length) {
      throw new Error("Texture data OOB");
    }

    const data = txf.textureData.rawData.slice(start, start + colorSize);
    const dataView = new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    const pix = new Uint8Array(size * 4);

    for (let pxIndex = 0; pxIndex < size; pxIndex++) {
      let colorIndex: number;
      switch (zthe.texelStorageFormat) {
        case GSPixelStorageFormat.PSMT8:
          colorIndex = data[pxIndex];
          break;
        case GSPixelStorageFormat.PSMT4: {
          const wordOffset = Math.floor(pxIndex / 8);
          const wordStart = wordOffset * 4;
          const word = dataView.getUint32(wordStart, true);
          const wordIndex = pxIndex % 8;
          const shift = wordIndex * 4;
          colorIndex = (word >> shift) & 0xf;
          break;
        }
        default:
          throw new Error("Something went wrong!");
      }

      const finalPixel = swizzled[colorIndex];
      let R: number, G: number, B: number, A: number;

      switch (clutHeader.pixelFormat) {
        case GSCLUTPixelStorageFormat.PSMCT16:
          [R, G, B, A] = extract16bitRGBA(finalPixel);
          break;
        case GSCLUTPixelStorageFormat.PSMCT32:
          [R, G, B, A] = extract32bitRGBA(finalPixel);
          break;
        default:
          throw new Error("Something went wrong!");
      }

      pix[pxIndex * 4 + 0] = R;
      pix[pxIndex * 4 + 1] = G;
      pix[pxIndex * 4 + 2] = B;
      pix[pxIndex * 4 + 3] = A;
    }

    mipMaps.push({
      height,
      width,
      image: { pix, width, height },
      isMipMap: k > 0,
    });

    break; // only extract highest level mipmap
  }

  return [
    {
      name: `texture_${zthe.textureId}`,
      textureId: zthe.textureId,
      files: mipMaps,
    },
  ];
}
