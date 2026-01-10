import { vec4 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type DebugInfo, dbgColor, dbgEnum, dbgNum } from "./debug";
import { FilterType, WrapMode } from "./textureEnums";

export class SamplerState {
  public wrapU = WrapMode.Repeat;
  public wrapV = WrapMode.Repeat;
  public wrapW = WrapMode.Repeat;
  public minFilter = FilterType.LinearMipmapLinear;
  public magFilter = FilterType.Linear;
  public anisoDegree = 1;
  public borderColor = vec4.create();
  public minLod: number = 0.0;
  public maxLod: number = 1000.0;
  public lodBias: number = 0.0;

  load(file: BAMFile, data: DataStream) {
    this.wrapU = data.readUint8() as WrapMode;
    this.wrapV = data.readUint8() as WrapMode;
    if (file.header.version.compare(new AssetVersion(5, 0)) >= 0) {
      this.wrapW = data.readUint8() as WrapMode;
    }
    this.minFilter = data.readUint8() as FilterType;
    this.magFilter = data.readUint8() as FilterType;
    this.anisoDegree = data.readInt16();
    if (file.header.version.compare(new AssetVersion(5, 0)) >= 0) {
      this.borderColor = data.readVec4();
    }
    if (file.header.version.compare(new AssetVersion(6, 36)) >= 0) {
      this.minLod = data.readStdFloat();
      this.maxLod = data.readStdFloat();
      this.lodBias = data.readStdFloat();
    }
  }

  getDebugInfo(): DebugInfo {
    const info: DebugInfo = new Map();

    // Only show wrap modes if not default (Repeat)
    if (this.wrapU !== WrapMode.Repeat || this.wrapV !== WrapMode.Repeat) {
      info.set("wrapU", dbgEnum(this.wrapU, WrapMode));
      info.set("wrapV", dbgEnum(this.wrapV, WrapMode));
    }
    if (this.wrapW !== WrapMode.Repeat) {
      info.set("wrapW", dbgEnum(this.wrapW, WrapMode));
    }

    info.set("minFilter", dbgEnum(this.minFilter, FilterType));
    info.set("magFilter", dbgEnum(this.magFilter, FilterType));

    if (this.anisoDegree !== 1) {
      info.set("anisoDegree", dbgNum(this.anisoDegree));
    }

    // Show border color if not default black
    const hasBorderColor =
      this.borderColor[0] !== 0 ||
      this.borderColor[1] !== 0 ||
      this.borderColor[2] !== 0 ||
      this.borderColor[3] !== 1;
    if (hasBorderColor) {
      info.set("borderColor", dbgColor(this.borderColor));
    }

    // Show LOD params if non-default
    if (
      this.minLod !== -1000.0 ||
      this.maxLod !== 1000.0 ||
      this.lodBias !== 0.0
    ) {
      info.set("minLod", dbgNum(this.minLod));
      info.set("maxLod", dbgNum(this.maxLod));
      info.set("lodBias", dbgNum(this.lodBias));
    }

    return info;
  }
}
