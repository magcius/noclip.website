import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgArray, dbgEnum, dbgNum, dbgRef } from "./debug";
import { GeomVertexArrayData } from "./GeomVertexArrayData";
import { NumericType, ShadeModel, UsageHint } from "./geomEnums";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

export class GeomPrimitive extends TypedObject {
  public shadeModel = ShadeModel.Smooth;
  public firstVertex = 0;
  public numVertices = -1;
  public indexType = NumericType.U8;
  public usageHint = UsageHint.Static;
  public vertices: GeomVertexArrayData | null = null;
  public ends: Int32Array = new Int32Array();

  override load(file: BAMFile, data: DataStream) {
    this.shadeModel = data.readUint8() as ShadeModel;
    this.firstVertex = data.readInt32();
    this.numVertices = data.readInt32();
    this.indexType = data.readUint8() as NumericType;
    this.usageHint = data.readUint8() as UsageHint;
    this.vertices = file.getTyped(data.readObjectId(), GeomVertexArrayData);
    this.ends = data.readPtaInt32();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.shadeModel = this.shadeModel;
    target.firstVertex = this.firstVertex;
    target.numVertices = this.numVertices;
    target.indexType = this.indexType;
    target.usageHint = this.usageHint;
    target.vertices = ctx.clone(this.vertices);
    target.ends = this.ends; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("shadeModel", dbgEnum(this.shadeModel, ShadeModel));
    info.set("firstVertex", dbgNum(this.firstVertex));
    info.set("numVertices", dbgNum(this.numVertices));
    info.set("indexType", dbgEnum(this.indexType, NumericType));
    info.set("usageHint", dbgEnum(this.usageHint, UsageHint));
    info.set("vertices", dbgRef(this.vertices));
    info.set("ends", dbgArray(Array.from(this.ends, dbgNum)));
    return info;
  }
}

export class GeomTristrips extends GeomPrimitive {}
export class GeomTriangles extends GeomPrimitive {}
export class GeomTrifans extends GeomPrimitive {}
export class GeomLines extends GeomPrimitive {}
export class GeomLinestrips extends GeomPrimitive {}
export class GeomPoints extends GeomPrimitive {}
export class GeomPatches extends GeomPrimitive {}

registerTypedObject("GeomPrimitive", GeomPrimitive);
registerTypedObject("GeomTristrips", GeomTristrips);
registerTypedObject("GeomTriangles", GeomTriangles);
registerTypedObject("GeomTrifans", GeomTrifans);
registerTypedObject("GeomLines", GeomLines);
registerTypedObject("GeomLinestrips", GeomLinestrips);
registerTypedObject("GeomPoints", GeomPoints);
registerTypedObject("GeomPatches", GeomPatches);
