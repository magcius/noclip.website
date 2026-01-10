import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgRef, dbgRefs, dbgStr } from "./debug";
import { GeomVertexArrayData } from "./GeomVertexArrayData";
import { GeomVertexFormat } from "./GeomVertexFormat";
import { UsageHint } from "./geomEnums";

export class GeomVertexData extends BAMObject {
  public name = "";
  public format: GeomVertexFormat | null = null;
  public usageHint = UsageHint.Static;
  public arrays: GeomVertexArrayData[] = [];
  public transformTable: BAMObject | null = null;
  public transformBlendTable: BAMObject | null = null;
  public sliderTable: BAMObject | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();
    this.format = file.getTyped(data.readObjectId(), GeomVertexFormat);
    this.usageHint = data.readUint8() as UsageHint;

    const numArrays = data.readUint16();
    this.arrays = readTypedRefs(file, data, numArrays, GeomVertexArrayData);

    this.transformTable = file.getObject(data.readObjectId());
    this.transformBlendTable = file.getObject(data.readObjectId());
    this.sliderTable = file.getObject(data.readObjectId());
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.name = this.name;
    target.format = this.format; // Shared
    target.usageHint = this.usageHint;
    target.arrays = this.arrays; // Shared
    target.transformTable = this.transformTable; // Shared
    target.transformBlendTable = this.transformBlendTable; // Shared
    target.sliderTable = this.sliderTable; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("name", dbgStr(this.name));
    info.set("format", dbgRef(this.format));
    info.set("usageHint", dbgEnum(this.usageHint, UsageHint));
    info.set("arrays", dbgRefs(this.arrays));
    info.set("transformTable", dbgRef(this.transformTable));
    info.set("transformBlendTable", dbgRef(this.transformBlendTable));
    info.set("sliderTable", dbgRef(this.sliderTable));
    return info;
  }
}

registerBAMObject("GeomVertexData", GeomVertexData);
