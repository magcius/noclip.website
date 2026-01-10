import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgNum, dbgRef, dbgRefs } from "./debug";
import { GeomPrimitive } from "./GeomPrimitive";
import { GeomVertexData } from "./GeomVertexData";
import { BoundsType, PrimitiveType, ShadeModel } from "./geomEnums";

export class Geom extends BAMObject {
  public data: GeomVertexData | null = null;
  public primitives: GeomPrimitive[] = [];
  public primitiveType = PrimitiveType.None;
  public shadeModel = ShadeModel.Uniform;
  public geomRendering = 0;
  public boundsType = BoundsType.Default;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.data = file.getTyped(data.readObjectId(), GeomVertexData);

    const numPrimitives = data.readUint16();
    this.primitives = readTypedRefs(file, data, numPrimitives, GeomPrimitive);

    this.primitiveType = data.readUint8() as PrimitiveType;
    this.shadeModel = data.readUint8() as ShadeModel;
    this.geomRendering = data.readUint16();

    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      this.boundsType = data.readUint8() as BoundsType;
    } else {
      this.boundsType = BoundsType.Default;
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.data = this.data; // Shared
    target.primitives = this.primitives; // Shared
    target.primitiveType = this.primitiveType;
    target.shadeModel = this.shadeModel;
    target.geomRendering = this.geomRendering;
    target.boundsType = this.boundsType;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("data", dbgRef(this.data));
    info.set("primitives", dbgRefs(this.primitives));
    info.set("primitiveType", dbgEnum(this.primitiveType, PrimitiveType));
    info.set("shadeModel", dbgEnum(this.shadeModel, ShadeModel));
    info.set("geomRendering", dbgNum(this.geomRendering));
    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      info.set("boundsType", dbgEnum(this.boundsType, BoundsType));
    }
    return info;
  }
}

registerBAMObject("Geom", Geom);
