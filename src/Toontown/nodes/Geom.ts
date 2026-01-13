import { vec3 } from "gl-matrix";
import { AABB } from "../../Geometry";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, CopyContext, readTypedRefs, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgNum, dbgRef, dbgRefs } from "./debug";
import { GeomPrimitive } from "./GeomPrimitive";
import type {
  GeomVertexArrayFormat,
  GeomVertexColumn,
} from "./GeomVertexArrayFormat";
import { GeomVertexData } from "./GeomVertexData";
import {
  BoundsType,
  Contents,
  NumericType,
  PrimitiveType,
  ShadeModel,
} from "./geomEnums";

export class Geom extends BAMObject {
  public data: GeomVertexData | null = null;
  public primitives: GeomPrimitive[] = [];
  public primitiveType = PrimitiveType.None;
  public shadeModel = ShadeModel.Smooth;
  public geomRendering = 0;
  public boundsType = BoundsType.Default;

  // Cached bounding box
  private _aabb: AABB | null = null;

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

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.data = ctx.clone(this.data);
    target.primitives = ctx.cloneArray(this.primitives);
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

  getBoundingBox(): AABB {
    if (!this._aabb) {
      this._aabb = computeAABBFromGeom(this);
    }
    return this._aabb;
  }
}

registerBAMObject("Geom", Geom);

/**
 * Compute AABB from vertex data by reading vertex positions
 */
export function computeAABBFromGeom(geom: Geom): AABB {
  const aabb = new AABB();

  const vertexData = geom.data;
  if (!vertexData) throw new Error("Missing vertex data for geom");

  const format = vertexData.format;
  if (!format) throw new Error("Missing vertex format");

  // Find the vertex position column
  let positionColumn: GeomVertexColumn | null = null;
  let positionArrayIdx = -1;
  let positionArrayFormat: GeomVertexArrayFormat | null = null;

  for (let arrayIdx = 0; arrayIdx < format.arrays.length; arrayIdx++) {
    const arrayFormat = format.arrays[arrayIdx];
    for (const column of arrayFormat.columns) {
      if (column.contents === Contents.Point) {
        positionColumn = column;
        positionArrayIdx = arrayIdx;
        positionArrayFormat = arrayFormat;
        break;
      }
    }
    if (positionColumn) break;
  }

  if (!positionColumn || positionArrayIdx < 0 || !positionArrayFormat) {
    return aabb;
  }

  // Get the vertex array data
  if (positionArrayIdx >= vertexData.arrays.length) {
    return aabb;
  }

  const arrayData = vertexData.arrays[positionArrayIdx];
  const buffer = arrayData.buffer;
  const stride = positionArrayFormat.stride;
  const offset = positionColumn.start;
  const numComponents = positionColumn.numComponents;
  const numericType = positionColumn.numericType;

  // Calculate number of vertices
  const numVertices = Math.floor(buffer.byteLength / stride);
  if (numVertices === 0) return aabb;

  // Create a DataView for reading
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  // Read vertex positions and expand AABB
  const pos = vec3.create();
  if (
    numericType === NumericType.F32
    // || (!file.header.useDouble && numericType === NumericType.StdFloat)
  ) {
    if (numComponents === 2) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat32(baseOffset, true);
        pos[1] = dataView.getFloat32(baseOffset + 4, true);
        aabb.unionPoint(pos);
      }
    } else if (numComponents === 3) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat32(baseOffset, true);
        pos[1] = dataView.getFloat32(baseOffset + 4, true);
        pos[2] = dataView.getFloat32(baseOffset + 8, true);
        aabb.unionPoint(pos);
      }
    } else {
      throw new Error(
        `Unsupported number of components for vertex: ${numComponents}`,
      );
    }
  } else if (
    numericType === NumericType.F64
    // || (file.header.useDouble && numericType === NumericType.StdFloat)
  ) {
    if (numComponents === 2) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat64(baseOffset, true);
        pos[1] = dataView.getFloat64(baseOffset + 8, true);
        aabb.unionPoint(pos);
      }
    } else if (numComponents === 3) {
      for (let i = 0; i < numVertices; i++) {
        const baseOffset = i * stride + offset;
        pos[0] = dataView.getFloat64(baseOffset, true);
        pos[1] = dataView.getFloat64(baseOffset + 8, true);
        pos[2] = dataView.getFloat64(baseOffset + 16, true);
        aabb.unionPoint(pos);
      }
    } else {
      throw new Error(
        `Unsupported number of components for vertex: ${numComponents}`,
      );
    }
  } else {
    throw new Error(`Unsupported numeric type for vertex: ${numericType}`);
  }

  return aabb;
}
