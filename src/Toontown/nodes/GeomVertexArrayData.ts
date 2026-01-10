import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgBytes, dbgEnum, dbgRef } from "./debug";
import { GeomVertexArrayFormat } from "./GeomVertexArrayFormat";
import { UsageHint } from "./geomEnums";

export class GeomVertexArrayData extends BAMObject {
  public arrayFormat: GeomVertexArrayFormat | null = null;
  public usageHint = UsageHint.Static;
  public buffer: Uint8Array = new Uint8Array(0);

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.arrayFormat = file.getTyped(
      data.readObjectId(),
      GeomVertexArrayFormat,
    );
    this.usageHint = data.readUint8() as UsageHint;

    if (this._version.compare(new AssetVersion(6, 8)) >= 0) {
      const size = data.readUint32();
      this.buffer = data.readUint8Array(size);
    } else {
      throw new Error(
        "BAM version < 6.8 not supported for GeomVertexArrayData",
      );
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.arrayFormat = this.arrayFormat; // Shared
    target.usageHint = this.usageHint;
    target.buffer = this.buffer; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("arrayFormat", dbgRef(this.arrayFormat));
    info.set("usageHint", dbgEnum(this.usageHint, UsageHint));
    info.set("buffer", dbgBytes(this.buffer.length));
    return info;
  }
}

registerBAMObject("GeomVertexArrayData", GeomVertexArrayData);
