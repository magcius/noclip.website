import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, CopyContext, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgEnum,
  dbgFields,
  dbgNum,
  dbgObject,
  dbgRef,
} from "./debug";
import { Contents, NumericType } from "./geomEnums";
import { InternalName } from "./InternalName";

const VERTEX_COLUMN_ALIGNMENT = 4;

export class GeomVertexColumn {
  public name: InternalName | null = null;
  public numComponents = 0;
  public numericType = NumericType.U8;
  public contents = Contents.Other;
  public start = 0;
  public columnAlignment = 1;

  // Computed fields
  public numElements = 0;
  public elementStride = 0;
  public numValues = 0;
  public componentBytes = 0;
  public totalBytes = 0;

  load(file: BAMFile, data: DataStream) {
    this.name = file.getTyped(data.readObjectId(), InternalName);
    this.numComponents = data.readUint8();
    this.numericType = data.readUint8() as NumericType;
    this.contents = data.readUint8() as Contents;
    this.start = data.readUint16();

    if (file.header.version.compare(new AssetVersion(6, 29)) >= 0) {
      this.columnAlignment = data.readUint8();
    } else {
      this.columnAlignment = 1;
    }

    this.setup(file);
  }

  copyTo(target: GeomVertexColumn, ctx: CopyContext): void {
    target.name = ctx.clone(this.name);
    target.numComponents = this.numComponents;
    target.numericType = this.numericType;
    target.contents = this.contents;
    target.start = this.start;
    target.columnAlignment = this.columnAlignment;
    target.numElements = this.numElements;
    target.elementStride = this.elementStride;
    target.numValues = this.numValues;
    target.componentBytes = this.componentBytes;
    target.totalBytes = this.totalBytes;
  }

  clone(ctx: CopyContext): GeomVertexColumn {
    const result = new GeomVertexColumn();
    this.copyTo(result, ctx);
    return result;
  }

  private setup(file: BAMFile): void {
    this.numValues = this.numComponents;

    let numericType = this.numericType;
    if (numericType === NumericType.StdFloat) {
      numericType = file.header.useDouble ? NumericType.F64 : NumericType.F32;
    }

    switch (numericType) {
      case NumericType.U8:
      case NumericType.I8:
        this.componentBytes = 1;
        break;
      case NumericType.U16:
      case NumericType.I16:
        this.componentBytes = 2;
        break;
      case NumericType.U32:
      case NumericType.I32:
        this.componentBytes = 4;
        break;
      case NumericType.PackedDCBA:
      case NumericType.PackedDABC:
        this.componentBytes = 4;
        this.numValues *= 4;
        break;
      case NumericType.F32:
        this.componentBytes = 4;
        break;
      case NumericType.F64:
        this.componentBytes = 8;
        break;
      case NumericType.PackedUFloat:
        this.componentBytes = 4;
        this.numValues *= 3;
        break;
    }

    if (this.numElements === 0) {
      if (this.contents === Contents.Matrix) {
        this.numElements = this.numComponents;
      } else {
        this.numElements = 1;
      }
    }

    if (this.columnAlignment < 1) {
      this.columnAlignment = Math.max(
        this.componentBytes,
        VERTEX_COLUMN_ALIGNMENT,
      );
    }

    // Align start
    this.start =
      Math.ceil(this.start / this.columnAlignment) * this.columnAlignment;

    if (this.elementStride < 1) {
      this.elementStride = this.componentBytes * this.numComponents;
    }

    this.totalBytes = this.elementStride * this.numElements;
  }

  getDebugInfo(): DebugInfo {
    return dbgFields([
      ["name", dbgRef(this.name)],
      ["numComponents", dbgNum(this.numComponents)],
      ["numericType", dbgEnum(this.numericType, NumericType)],
      ["contents", dbgEnum(this.contents, Contents)],
      ["start", dbgNum(this.start)],
      ["totalBytes", dbgNum(this.totalBytes)],
    ]);
  }
}

export class GeomVertexArrayFormat extends BAMObject {
  public stride = 0;
  public totalBytes = 0;
  public padTo = 0;
  public divisor = 0;
  public columns: GeomVertexColumn[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.stride = data.readUint16();
    this.totalBytes = data.readUint16();
    this.padTo = data.readUint8();

    if (this._version.compare(new AssetVersion(6, 36)) > 0) {
      this.divisor = data.readUint16();
    } else {
      this.divisor = 0;
    }

    const numColumns = data.readUint16();
    for (let i = 0; i < numColumns; i++) {
      const column = new GeomVertexColumn();
      column.load(file, data);
      this.columns.push(column);
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.stride = this.stride;
    target.totalBytes = this.totalBytes;
    target.padTo = this.padTo;
    target.divisor = this.divisor;
    target.columns = this.columns.map((c) => c.clone(ctx));
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("stride", dbgNum(this.stride));
    info.set("totalBytes", dbgNum(this.totalBytes));
    info.set("padTo", dbgNum(this.padTo));
    if (this._version.compare(new AssetVersion(6, 36)) > 0) {
      info.set("divisor", dbgNum(this.divisor));
    }
    info.set(
      "columns",
      dbgArray(this.columns.map((c) => dbgObject(c.getDebugInfo()))),
    );
    return info;
  }
}

registerBAMObject("GeomVertexArrayFormat", GeomVertexArrayFormat);
