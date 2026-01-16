import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgEnum, dbgRef, dbgRefs, dbgStr } from "./debug";
import { GeomVertexArrayData } from "./GeomVertexArrayData";
import { GeomVertexFormat } from "./GeomVertexFormat";
import { UsageHint } from "./geomEnums";
import { SliderTable } from "./SliderTable";
import { TransformBlendTable } from "./TransformBlendTable";
import { TransformTable } from "./TransformTable";
import {
  type CopyContext,
  readTypedRefs,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export class GeomVertexData extends TypedObject {
  public name = "";
  public format: GeomVertexFormat | null = null;
  public usageHint = UsageHint.Static;
  public arrays: GeomVertexArrayData[] = [];
  public transformTable: TransformTable | null = null;
  public transformBlendTable: TransformBlendTable | null = null;
  public sliderTable: SliderTable | null = null;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.name = data.readString();
    this.format = file.getTyped(data.readObjectId(), GeomVertexFormat);
    this.usageHint = data.readUint8() as UsageHint;

    const numArrays = data.readUint16();
    this.arrays = readTypedRefs(file, data, numArrays, GeomVertexArrayData);

    this.transformTable = file.getTyped(data.readObjectId(), TransformTable);
    this.transformBlendTable = file.getTyped(
      data.readObjectId(),
      TransformBlendTable,
    );
    this.sliderTable = file.getTyped(data.readObjectId(), SliderTable);
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.name = this.name;
    target.format = ctx.clone(this.format);
    target.usageHint = this.usageHint;
    target.arrays = ctx.cloneArray(this.arrays);
    target.transformTable = ctx.clone(this.transformTable);
    target.transformBlendTable = ctx.clone(this.transformBlendTable);
    target.sliderTable = ctx.clone(this.sliderTable);
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

registerTypedObject("GeomVertexData", GeomVertexData);
