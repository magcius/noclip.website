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
  rawData: Uint8Array;
}

export interface ZTHE {
  textureCount: number;
  textures: ZTHETexture[];
  rawData: Uint8Array;
}

export function parseZTHE(buf: Uint8Array): ZTHE {
  const raw = buf;
  const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const texCount = rawView.getUint32(8, true);
  buf = buf.slice(12);

  const textures: ZTHETexture[] = [];

  for (let i = 0; i + 0x48 <= buf.length; i += 0x48) {
    const data = buf.slice(i, i + 0x48);
    const dataView = new DataView(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    const imageCount = data[0x31];

    const metaHeaders: ZTHETextureMetaHeader[] = [];
    for (let j = 0; j < imageCount; j++) {
      const offset = j * 0xc;
      const hData = data.slice(offset, offset + 0xc);
      const hView = new DataView(
        hData.buffer,
        hData.byteOffset,
        hData.byteLength,
      );
      metaHeaders.push({
        txdaAddressOffset: hView.getUint32(0, true),
        blockHeightPixels: hView.getUint16(0x6, true),
        selfPlusMemAllocRes: hView.getUint16(0x8, true),
        ramDestWidth: hView.getUint16(0xa, true),
      });
    }

    textures.push({
      texelStorageFormat: data[0x30],
      imageCount,
      blockWidthPixels: dataView.getUint16(0x3e, true),
      images: metaHeaders,
      textureId: dataView.getUint16(0x34, true),
      clutHeaderIndex: data[0x44],
      rawData: data,
    });
  }

  if (texCount !== textures.length) {
    throw new Error("TexCount != length of textures!");
  }

  return { textureCount: texCount, textures, rawData: raw };
}
