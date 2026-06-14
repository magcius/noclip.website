import { readUint32LE, readUint16LE } from "../../helpers/bytes";

export interface ZTHETextureMetaHeader {
  txdaAddressOffset: number;
  blockHeightPixels: number;
  selfPlusMemAllocRes: number;
  ramDestWidth: number;
}

export interface ZTHETexture {
  images: ZTHETextureMetaHeader[];
  texelStorageFormat: number;
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
  const texCount = readUint32LE(buf, 8);
  buf = buf.slice(12);

  const textures: ZTHETexture[] = [];

  for (let i = 0; i + 0x48 <= buf.length; i += 0x48) {
    const data = buf.slice(i, i + 0x48);
    const imageCount = data[0x31];

    const metaHeaders: ZTHETextureMetaHeader[] = [];
    for (let j = 0; j < imageCount; j++) {
      const offset = j * 0xc;
      const hData = data.slice(offset, offset + 0xc);
      metaHeaders.push({
        txdaAddressOffset: readUint32LE(hData, 0),
        blockHeightPixels: readUint16LE(hData, 0x6),
        selfPlusMemAllocRes: readUint16LE(hData, 0x8),
        ramDestWidth: readUint16LE(hData, 0xa),
      });
    }

    textures.push({
      texelStorageFormat: data[0x30],
      imageCount,
      blockWidthPixels: readUint16LE(data, 0x3e),
      images: metaHeaders,
      textureId: readUint16LE(data, 0x34),
      clutHeaderIndex: data[0x44],
      rawData: data,
    });
  }

  if (texCount !== textures.length) {
    throw new Error("TexCount != length of textures!");
  }

  return { textureCount: texCount, textures, rawData: raw };
}
