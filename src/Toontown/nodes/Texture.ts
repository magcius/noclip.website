import { vec3, type vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgBytes,
  dbgColor,
  dbgEnum,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgStr,
  dbgVec3,
} from "./debug";
import { UsageHint } from "./geomEnums";
import { SamplerState } from "./SamplerState";
import {
  AutoTextureScale,
  ComponentType,
  CompressionMode,
  Format,
  QualityLevel,
  TextureType,
} from "./textureEnums";

export interface TextureData {
  size: vec3;
  padSize: vec3;
  numViews: number;
  componentType: ComponentType;
  componentWidth: number;
  ramImageCompression: CompressionMode;
  ramImageCount: number;
  ramImages: Array<{ pageSize: number; data: Uint8Array }>;
}

export class Texture extends BAMObject {
  public name = "";
  public filename = "";
  public alphaFilename = "";
  public colorNumChannels = 0;
  public alphaNumChannels = 0;
  public textureType = TextureType.Texture2D;
  public hasReadMipmaps = false;

  // Body (5.0+ format)
  public defaultSampler = new SamplerState();
  public format = Format.RGB;
  public compression = CompressionMode.Default;
  public usageHint = UsageHint.Unspecified;
  public qualityLevel = QualityLevel.Default;
  public autoTextureScale = AutoTextureScale.Unspecified;
  public numComponents = 0;
  public origFileXSize = 0;
  public origFileYSize = 0;
  public simpleXSize = 0;
  public simpleYSize = 0;
  public simpleImageDateGenerated = 0;
  public simpleImage: Uint8Array | null = null;
  public clearColor: vec4 | null = null;

  // Pre-5.0 format fields
  public pbufferFormat: Format | null = null;

  // Raw texture data (optional)
  public rawData: TextureData | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();
    this.filename = data.readString();
    this.alphaFilename = data.readString();

    // Pre-5.0 format: simpler structure
    if (this._version.compare(new AssetVersion(5, 0)) < 0) {
      // BAM 4.3+: color and alpha channel counts
      if (this._version.compare(new AssetVersion(4, 3)) >= 0) {
        this.colorNumChannels = data.readUint8();
        this.alphaNumChannels = data.readUint8();
      }

      // BAM 4.5+: rawdata mode flag (before sampler properties)
      let hasRawdata = false;
      if (this._version.compare(new AssetVersion(4, 5)) >= 0) {
        hasRawdata = data.readBool();
      }

      this.defaultSampler.load(file, data);

      // Optional PixelBuffer data
      const hasPbuffer = data.readBool();
      if (hasPbuffer) {
        this.pbufferFormat = data.readUint8() as Format;
        this.numComponents = data.readUint8();

        if (hasRawdata) {
          // Read raw pixel buffer data
          const xsize = data.readInt32();
          const ysize = data.readInt32();
          const imageType = data.readUint8() as ComponentType;
          data.readUint8(); // numComponents (again)
          const componentWidth = data.readUint8();
          const imageSize = data.readUint32();
          const imageData = data.readUint8Array(imageSize);

          this.rawData = {
            size: [xsize, ysize, 1],
            padSize: [0, 0, 0],
            numViews: 1,
            componentType: imageType as ComponentType,
            componentWidth,
            ramImageCompression: CompressionMode.Off,
            ramImageCount: 1,
            ramImages: [{ pageSize: 0, data: imageData }],
          };
        }
      }

      return;
    }

    // BAM 5.0+ format
    this.colorNumChannels = data.readUint8();
    this.alphaNumChannels = data.readUint8();
    const hasRawdata = data.readBool();
    this.textureType = data.readUint8() as TextureType;

    // Handle texture type shift for versions < 6.25
    if (this._version.compare(new AssetVersion(6, 25)) < 0) {
      if (this.textureType === TextureType.Texture2DArray) {
        this.textureType = TextureType.CubeMap;
      }
    }

    if (this._version.compare(new AssetVersion(6, 32)) >= 0) {
      this.hasReadMipmaps = data.readBool();
    }

    this.defaultSampler.load(file, data);

    if (this._version.compare(new AssetVersion(6, 1)) >= 0) {
      this.compression = data.readUint8() as CompressionMode;
    }

    if (this._version.compare(new AssetVersion(6, 16)) >= 0) {
      this.qualityLevel = data.readUint8() as QualityLevel;
    }

    this.format = data.readUint8() as Format;
    this.numComponents = data.readUint8();

    if (this.textureType === TextureType.BufferTexture) {
      this.usageHint = data.readUint8() as UsageHint;
    }

    if (this._version.compare(new AssetVersion(6, 28)) >= 0) {
      this.autoTextureScale = data.readUint8() as AutoTextureScale;
    }

    let hasSimpleRamImage = false;
    if (this._version.compare(new AssetVersion(6, 18)) >= 0) {
      this.origFileXSize = data.readUint32();
      this.origFileYSize = data.readUint32();
      hasSimpleRamImage = data.readBool();
    }

    if (hasSimpleRamImage) {
      this.simpleXSize = data.readUint32();
      this.simpleYSize = data.readUint32();
      this.simpleImageDateGenerated = data.readInt32();
      const size = data.readUint32();
      this.simpleImage = data.readUint8Array(size);
    }

    if (
      this._version.compare(new AssetVersion(6, 45)) >= 0 &&
      data.readBool()
    ) {
      this.clearColor = data.readVec4();
    }

    // Read raw data if present
    if (hasRawdata) {
      this.rawData = this.readTextureData(data);
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.name = this.name;
    target.filename = this.filename;
    target.alphaFilename = this.alphaFilename;
    target.colorNumChannels = this.colorNumChannels;
    target.alphaNumChannels = this.alphaNumChannels;
    target.textureType = this.textureType;
    target.hasReadMipmaps = this.hasReadMipmaps;
    target.defaultSampler = this.defaultSampler; // Shared
    target.format = this.format;
    target.compression = this.compression;
    target.usageHint = this.usageHint;
    target.qualityLevel = this.qualityLevel;
    target.autoTextureScale = this.autoTextureScale;
    target.numComponents = this.numComponents;
    target.origFileXSize = this.origFileXSize;
    target.origFileYSize = this.origFileYSize;
    target.simpleXSize = this.simpleXSize;
    target.simpleYSize = this.simpleYSize;
    target.simpleImageDateGenerated = this.simpleImageDateGenerated;
    target.simpleImage = this.simpleImage; // Shared
    target.clearColor = this.clearColor; // Shared
    target.pbufferFormat = this.pbufferFormat;
    target.rawData = this.rawData; // Shared
  }

  private readTextureData(data: DataStream): TextureData {
    const sizeX = data.readUint32();
    const sizeY = data.readUint32();
    const sizeZ = data.readUint32();
    const size = vec3.fromValues(sizeX, sizeY, sizeZ);

    let padSize = vec3.create();
    if (this._version.compare(new AssetVersion(6, 30)) >= 0) {
      const padSizeX = data.readUint32();
      const padSizeY = data.readUint32();
      const padSizeZ = data.readUint32();
      padSize = vec3.fromValues(padSizeX, padSizeY, padSizeZ);
    }

    let numViews = 1;
    if (this._version.compare(new AssetVersion(6, 26)) >= 0) {
      numViews = data.readUint32();
    }

    const componentType = data.readUint8() as ComponentType;
    const componentWidth = data.readUint8();

    let ramImageCompression = CompressionMode.Off;
    if (this._version.compare(new AssetVersion(6, 1)) >= 0) {
      ramImageCompression = data.readUint8() as CompressionMode;
    }

    let ramImageCount = 1;
    if (this._version.compare(new AssetVersion(6, 3)) >= 0) {
      ramImageCount = data.readUint8();
    }

    const ramImages: Array<{ pageSize: number; data: Uint8Array }> = [];
    for (let i = 0; i < ramImageCount; i++) {
      let pageSize = 0;
      if (this._version.compare(new AssetVersion(6, 1)) >= 0) {
        pageSize = data.readUint32();
      }
      const imageSize = data.readUint32();
      const imageData = data.readUint8Array(imageSize);
      ramImages.push({ pageSize, data: imageData });
    }

    return {
      size,
      padSize,
      numViews,
      componentType,
      componentWidth,
      ramImageCompression,
      ramImageCount,
      ramImages,
    };
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));

    if (this.filename) {
      info.set("filename", dbgStr(this.filename));
    }
    if (this.alphaFilename) {
      info.set("alphaFilename", dbgStr(this.alphaFilename));
    }

    info.set("textureType", dbgEnum(this.textureType, TextureType));

    // Pre-5.0: show pbufferFormat, 5.0+: show format
    if (this.pbufferFormat !== null) {
      info.set("pbufferFormat", dbgEnum(this.pbufferFormat, Format));
    } else {
      info.set("format", dbgEnum(this.format, Format));
    }

    if (this.compression !== CompressionMode.Default) {
      info.set("compression", dbgEnum(this.compression, CompressionMode));
    }

    if (this.numComponents !== 0) {
      info.set("numComponents", dbgNum(this.numComponents));
    }

    if (this.origFileXSize !== 0 || this.origFileYSize !== 0) {
      info.set(
        "origSize",
        dbgStr(`${this.origFileXSize}x${this.origFileYSize}`),
      );
    }

    info.set("sampler", dbgObject(this.defaultSampler.getDebugInfo()));

    if (this.simpleImage !== null) {
      info.set(
        "simpleImage",
        dbgStr(`${this.simpleXSize}x${this.simpleYSize}`),
      );
    }

    if (this.clearColor !== null) {
      info.set("clearColor", dbgColor(this.clearColor));
    }

    if (this.rawData !== null) {
      const rd = this.rawData;
      const totalBytes = rd.ramImages.reduce(
        (sum, img) => sum + img.data.length,
        0,
      );
      info.set(
        "rawData",
        dbgObject(
          dbgFields([
            ["size", dbgVec3(rd.size)],
            ["componentType", dbgEnum(rd.componentType, ComponentType)],
            ["ramImageCount", dbgNum(rd.ramImageCount)],
            ["totalBytes", dbgBytes(totalBytes)],
          ]),
        ),
      );
    }

    return info;
  }
}

registerBAMObject("Texture", Texture);
