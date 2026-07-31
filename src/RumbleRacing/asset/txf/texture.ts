import ArrayBufferSlice from "../../../ArrayBufferSlice";
import {
  GSCLUTPixelStorageFormat,
  GSPixelStorageFormat,
  gsMemoryMapNew,
  gsMemoryMapReadImagePSMT4_PSMCT16,
  gsMemoryMapReadImagePSMT4_PSMCT32,
  gsMemoryMapReadImagePSMT8_PSMCT16,
  gsMemoryMapReadImagePSMT8_PSMCT32,
  gsMemoryMapUploadImage,
} from "../../../Common/PS2/GS";
import { TXF } from "./TXF";
import { CLHEEntry } from "./CLHE";
import { ZTHETexture } from "./ZTHE";

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

// These values will make the shared PS2 GS code return the same alpha values
// that I was originally setting on my own before using the shared code.
const CLUT16_TA0 = 0x8080;
const CLUT16_TA1 = 0x0040;

export function extractTexturesFromZTHE(
  txf: TXF,
  clutHeader: CLHEEntry,
  zthe: ZTHETexture,
): Texture[] {
  const mipMaps: TextureFile[] = [];

  let clutWidth: number, clutHeight: number;
  switch (zthe.texelStorageFormat) {
    case GSPixelStorageFormat.PSMT8:
      clutWidth = 16;
      clutHeight = 16;
      break;
    case GSPixelStorageFormat.PSMT4:
      clutWidth = 8;
      clutHeight = 2;
      break;
    default:
      throw new Error("Unhandled indexed texel format!");
  }

  let clutPixelBytes: number;
  let clutUploadFormat: GSPixelStorageFormat;
  switch (clutHeader.pixelFormat) {
    case GSCLUTPixelStorageFormat.PSMCT32:
      clutPixelBytes = 4;
      clutUploadFormat = GSPixelStorageFormat.PSMCT32;
      break;
    case GSCLUTPixelStorageFormat.PSMCT16:
      clutPixelBytes = 2;
      clutUploadFormat = GSPixelStorageFormat.PSMCT16;
      break;
    default:
      throw new Error("Unhandled clut size!");
  }

  const clutStart = clutHeader.cldaStartOffset;
  const clutSize = clutWidth * clutHeight * clutPixelBytes;
  const clutData = txf.clutData.rawData.slice(clutStart, clutStart + clutSize);

  const cbp = clutHeader.vramDest;

  const gsMap = gsMemoryMapNew();
  gsMemoryMapUploadImage(
    gsMap,
    clutUploadFormat,
    cbp,
    1,
    0,
    0,
    clutWidth,
    clutHeight,
    ArrayBufferSlice.fromView(clutData),
  );

  for (let k = 0; k < zthe.images.length; k++) {
    const txImage = zthe.images[k];

    const height = txImage.blockHeightPixels;
    const width = zthe.blockWidthPixels >> k;

    const size = height * width;
    const texelBytes =
      zthe.texelStorageFormat === GSPixelStorageFormat.PSMT4 ? size / 2 : size;

    const start = txImage.txdaAddressOffset;
    const data = txf.textureData.rawData.slice(start, start + texelBytes);
    const tbp0 = txImage.selfPlusMemAllocRes;
    const tbw = txImage.ramDestWidth;

    gsMemoryMapUploadImage(
      gsMap,
      zthe.texelStorageFormat,
      tbp0,
      tbw,
      0,
      0,
      width,
      height,
      ArrayBufferSlice.fromView(data),
    );

    const pix = new Uint8Array(size * 4);
    const psmct32Clut =
      clutHeader.pixelFormat === GSCLUTPixelStorageFormat.PSMCT32;

    if (zthe.texelStorageFormat === GSPixelStorageFormat.PSMT4) {
      if (psmct32Clut)
        gsMemoryMapReadImagePSMT4_PSMCT32(
          pix,
          gsMap,
          tbp0,
          tbw,
          width,
          height,
          cbp,
          0,
          -1,
        );
      else
        gsMemoryMapReadImagePSMT4_PSMCT16(
          pix,
          gsMap,
          tbp0,
          tbw,
          width,
          height,
          cbp,
          0,
          CLUT16_TA0,
          CLUT16_TA1,
        );
    } else {
      if (psmct32Clut)
        gsMemoryMapReadImagePSMT8_PSMCT32(
          pix,
          gsMap,
          tbp0,
          tbw,
          width,
          height,
          cbp,
          -1,
        );
      else
        gsMemoryMapReadImagePSMT8_PSMCT16(
          pix,
          gsMap,
          tbp0,
          tbw,
          width,
          height,
          cbp,
          CLUT16_TA0,
          CLUT16_TA1,
        );
    }

    mipMaps.push({
      height,
      width,
      image: { pix, width, height },
      isMipMap: k > 0,
    });
  }

  return [
    {
      name: `texture_${zthe.textureId}`,
      textureId: zthe.textureId,
      files: mipMaps,
    },
  ];
}
