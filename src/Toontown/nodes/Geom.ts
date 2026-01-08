import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgNum, dbgRef, dbgRefs } from "./debug";
import { BoundsType, PrimitiveType, ShadeModel } from "./geomEnums";

export class Geom extends BAMObject {
  public dataRef: number;
  public primitiveRefs: number[] = [];
  public primitiveType: PrimitiveType;
  public shadeModel: ShadeModel;
  public geomRendering: number;
  public boundsType: BoundsType;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // Cycler data
    this.dataRef = data.readObjectId();

    const numPrimitives = data.readUint16();
    for (let i = 0; i < numPrimitives; i++) {
      this.primitiveRefs.push(data.readObjectId());
    }

    this.primitiveType = data.readUint8() as PrimitiveType;
    this.shadeModel = data.readUint8() as ShadeModel;
    this.geomRendering = data.readUint16();

    if (this._version.compare(new AssetVersion(6, 19)) >= 0) {
      this.boundsType = data.readUint8() as BoundsType;
    } else {
      this.boundsType = BoundsType.Default;
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("dataRef", dbgRef(this.dataRef));
    info.set("primitiveRefs", dbgRefs(this.primitiveRefs));
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
