import { mat4, vec2 } from "gl-matrix";
import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { type CopyContext, registerBAMObject } from "./base";
import { CollisionPlane } from "./CollisionPlane";
import {
  type DebugInfo,
  dbgArray,
  dbgBool,
  dbgEnum,
  dbgFields,
  dbgMat4,
  dbgObject,
  dbgVec2,
} from "./debug";

// Axis type for pre-5.0 format
enum AxisType {
  XY = 0,
  XZ = 1,
  YZ = 2,
}

export class CollisionPolygon extends CollisionPlane {
  // BAM 5.0+ format
  public points: Array<{ point: vec2; vector?: vec2 }> = [];
  public to2dMatrix = mat4.create();

  // Pre-5.0 format
  public median = vec2.create();
  public axis = AxisType.XY;
  public reversed = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const pointCount = data.readUint16();

    if (this._version.compare(new AssetVersion(5, 0)) >= 0) {
      // BAM 5.0+ format: point + vector pairs, then to_2d_mat
      for (let i = 0; i < pointCount; i++) {
        const point = data.readVec2();
        const vector = data.readVec2();
        this.points.push({ point, vector });
      }
      this.to2dMatrix = data.readMat4();
    } else {
      // Pre-5.0 format: just points, then median/axis/reversed
      for (let i = 0; i < pointCount; i++) {
        const point = data.readVec2();
        this.points.push({ point });
      }
      this.median = data.readVec2();
      this.axis = data.readUint8() as AxisType;
      this.reversed = data.readUint8() !== 0;
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.points = this.points; // Shared
    mat4.copy(target.to2dMatrix, this.to2dMatrix);
    vec2.copy(target.median, this.median);
    target.axis = this.axis;
    target.reversed = this.reversed;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set(
      "points",
      dbgArray(
        this.points.map((p) => {
          if (this._version.compare(new AssetVersion(5, 0)) >= 0) {
            return dbgObject(
              dbgFields([
                ["point", dbgVec2(p.point)],
                ["vector", dbgVec2(p.vector as vec2)],
              ]),
              true,
            );
          } else {
            return dbgVec2(p.point);
          }
        }),
      ),
    );
    if (this._version.compare(new AssetVersion(5, 0)) >= 0) {
      info.set("to2dMatrix", dbgMat4(this.to2dMatrix));
    } else {
      info.set("median", dbgVec2(this.median));
      info.set("axis", dbgEnum(this.axis, AxisType));
      info.set("reversed", dbgBool(this.reversed));
    }
    return info;
  }
}

registerBAMObject("CollisionPolygon", CollisionPolygon);
