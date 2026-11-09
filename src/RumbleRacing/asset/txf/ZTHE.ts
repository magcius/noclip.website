import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { GSPixelStorageFormat } from "../../../Common/PS2/GS";

export interface ZTHETextureMetaHeader {
  txdaAddressOffset: number;
  blockHeightPixels: number;
  selfPlusMemAllocRes: number;
  ramDestWidth: number;
}

export interface ZTHETexture {
  images: ZTHETextureMetaHeader[];
  texelStorageFormat: GSPixelStorageFormat;
  imageCount: number;
  blockWidthPixels: number;
  clutHeaderIndex: number;
  textureId: number;
  rawData: ArrayBufferSlice;
}

export interface ZTHE {
  textureCount: number;
  textures: ZTHETexture[];
  rawData: ArrayBufferSlice;
}

export function parseZTHE(buf: ArrayBufferSlice): ZTHE {
  const texCount = buf.createDataView().getUint32(8, true);
  const body = buf.subarray(12);

  const textures: ZTHETexture[] = [];

  for (let i = 0; i + 0x48 <= body.byteLength; i += 0x48) {
    const data = body.subarray(i, 0x48);
    const dataView = data.createDataView();
    const imageCount = dataView.getUint8(0x31);

    const metaHeaders: ZTHETextureMetaHeader[] = [];
    for (let j = 0; j < imageCount; j++) {
      const offset = j * 0xc;
      metaHeaders.push({
        txdaAddressOffset: dataView.getUint32(offset, true),
        blockHeightPixels: dataView.getUint16(offset + 0x6, true),
        selfPlusMemAllocRes: dataView.getUint16(offset + 0x8, true),
        ramDestWidth: dataView.getUint16(offset + 0xa, true),
      });
    }

    textures.push({
      texelStorageFormat: dataView.getUint8(0x30),
      imageCount,
      blockWidthPixels: dataView.getUint16(0x3e, true),
      images: metaHeaders,
      textureId: dataView.getUint16(0x34, true),
      clutHeaderIndex: dataView.getUint8(0x44),
      rawData: data,
    });
  }

  if (texCount !== textures.length) {
    throw new Error("TexCount != length of textures!");
  }

  return { textureCount: texCount, textures, rawData: buf };
}
