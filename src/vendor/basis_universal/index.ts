// @ts-ignore
import Module from "./basis_transcoder";

export enum BasisFormat {
  cTFETC1,
  cTFETC2,
  cTFBC1,
  cTFBC3,
  cTFBC4,
  cTFBC5,
  cTFBC7_M6_OPAQUE_ONLY,
  cTFBC7_M5,
  cTFPVRTC1_4_RGB,
  cTFPVRTC1_4_RGBA,
  cTFASTC_4x4,
  cTFATC_RGB,
  cTFATC_RGBA_INTERPOLATED_ALPHA,
  cTFRGBA32,
  cTFRGB565,
  cTFBGR565,
  cTFRGBA4444,
}

export var BasisFile: BasisFile;
export interface BasisFile {
  new(data: Uint8Array): BasisFile;
  delete(): void;
  close(): void;
  getHasAlpha(): number;
  getNumImages(): number;
  getNumLevels(imageIndex: number): number;
  getImageWidth(imageIndex: number, levelIndex: number): number;
  getImageHeight(imageIndex: number, levelIndex: number): number;
  getImageTranscodedSizeInBytes(imageIndex: number, levelIndex: number, format: BasisFormat): number;
  startTranscoding(): number;
  transcodeImage(dst: Uint8Array, imageIndex: number, levelIndex: number, format: BasisFormat, unused: any, getAlphaForOpaqueFormats: number): number;
}

export async function initializeBasis(): Promise<void> {
  if (BasisFile) return;
  return new Promise(resolve => Module().then((module: any) => {
    module.initializeBasis();
    BasisFile = module.BasisFile;
    resolve();
  }));
}
