import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgRef, dbgRefs, dbgStr } from "./debug";
import { UsageHint } from "./geomEnums";

export class GeomVertexData extends BAMObject {
  public name: string;
  public formatRef: number;
  public usageHint: UsageHint;
  public arrayRefs: number[] = [];
  public transformTableRef: number;
  public transformBlendTableRef: number;
  public sliderTableRef: number;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    this.name = data.readString();

    // Cycler data
    this.formatRef = data.readObjectId();
    this.usageHint = data.readUint8() as UsageHint;

    const numArrays = data.readUint16();
    for (let i = 0; i < numArrays; i++) {
      this.arrayRefs.push(data.readObjectId());
    }

    this.transformTableRef = data.readObjectId();
    this.transformBlendTableRef = data.readObjectId();
    this.sliderTableRef = data.readObjectId();
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("formatRef", dbgRef(this.formatRef));
    info.set("usageHint", dbgEnum(this.usageHint, UsageHint));
    info.set("arrayRefs", dbgRefs(this.arrayRefs));
    info.set("transformTableRef", dbgRef(this.transformTableRef));
    info.set("transformBlendTableRef", dbgRef(this.transformBlendTableRef));
    info.set("sliderTableRef", dbgRef(this.sliderTableRef));
    return info;
  }
}

registerBAMObject("GeomVertexData", GeomVertexData);
