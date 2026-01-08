import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgEnum,
  dbgNum,
  dbgRef,
} from "./debug";
import { NumericType, ShadeModel, UsageHint } from "./geomEnums";

export class GeomPrimitive extends BAMObject {
  public shadeModel: ShadeModel;
  public firstVertex: number;
  public numVertices: number;
  public indexType: NumericType;
  public usageHint: UsageHint;
  public verticesRef: number | null = null;
  public ends: number[] | null = null;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // Cycler data
    this.shadeModel = data.readUint8() as ShadeModel;
    this.firstVertex = data.readInt32();
    this.numVertices = data.readInt32();
    this.indexType = data.readUint8() as NumericType;
    this.usageHint = data.readUint8() as UsageHint;

    // Vertices reference (optional)
    const vertRef = data.readObjectId();
    if (vertRef !== 0) {
      this.verticesRef = vertRef;
    }

    // PTA for ends (tristrip end indices)
    // PTA IDs use the same dynamic format as object IDs (u16/u32)
    // Note: The array data (size + elements) is always written inline when:
    // - ptaId is 0 (NULL pointer) - size will be 0
    // - ptaId is a new ID we haven't seen before - size will be actual count
    // When ptaId references an already-registered array, no additional data is read.
    // For simplicity, we always read inline since we don't track PTA references.
    const _ptaId = data.readObjectId();
    const size = data.readUint32();
    if (size > 0) {
      this.ends = [];
      for (let i = 0; i < size; i++) {
        this.ends.push(data.readInt32());
      }
    }
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("shadeModel", dbgEnum(this.shadeModel, ShadeModel));
    info.set("firstVertex", dbgNum(this.firstVertex));
    info.set("numVertices", dbgNum(this.numVertices));
    info.set("indexType", dbgEnum(this.indexType, NumericType));
    info.set("usageHint", dbgEnum(this.usageHint, UsageHint));

    if (this.verticesRef !== null) {
      info.set("verticesRef", dbgRef(this.verticesRef));
    }

    if (this.ends !== null) {
      info.set("ends", dbgArray(this.ends.map(dbgNum)));
    }

    return info;
  }
}

registerBAMObject("GeomPrimitive", GeomPrimitive);
registerBAMObject("GeomTristrips", GeomPrimitive);
registerBAMObject("GeomTriangles", GeomPrimitive);
registerBAMObject("GeomTrifans", GeomPrimitive);
registerBAMObject("GeomLines", GeomPrimitive);
registerBAMObject("GeomLinestrips", GeomPrimitive);
registerBAMObject("GeomPoints", GeomPrimitive);
registerBAMObject("GeomPatches", GeomPrimitive);
