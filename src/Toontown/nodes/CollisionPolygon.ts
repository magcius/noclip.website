import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
  type DebugInfo,
  dbgArray,
  dbgBool,
  dbgEnum,
  dbgFields,
  dbgFlags,
  dbgMat4,
  dbgNum,
  dbgObject,
  dbgVec2,
  dbgVec3,
  dbgVec4,
} from "./debug";

// CollisionSolid flags
const F_EFFECTIVE_NORMAL = 1 << 1;

const CollisionSolidFlags = {
  Tangible: 1 << 0,
  EffectiveNormal: F_EFFECTIVE_NORMAL,
};

// Axis type for pre-5.0 format
enum AxisType {
  XY = 0,
  XZ = 1,
  YZ = 2,
}

export class CollisionPolygon extends BAMObject {
  // CollisionSolid fields
  public flags: number;
  public effectiveNormal: [number, number, number] = [0, 0, 0];

  // CollisionPlane fields
  public plane: [number, number, number, number];

  // CollisionPolygon fields (BAM 5.0+ format)
  public points: Array<{ point: [number, number]; vector?: [number, number] }> =
    [];
  public to2dMatrix: number[] = [];

  // CollisionPolygon fields (pre-5.0 format)
  public median: [number, number] = [0, 0];
  public axis: AxisType = AxisType.XY;
  public reversed: boolean = false;

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // Read CollisionSolid base
    this.flags = data.readUint8();
    if (this.flags & F_EFFECTIVE_NORMAL) {
      this.effectiveNormal = data.readVec3();
    }

    // Read CollisionPlane data
    this.plane = data.readVec4();

    // Read CollisionPolygon data
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

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("flags", dbgFlags(this.flags, CollisionSolidFlags));
    if (this.flags & F_EFFECTIVE_NORMAL) {
      info.set("effectiveNormal", dbgVec3(this.effectiveNormal));
    }
    info.set("plane", dbgVec4(this.plane));
    info.set(
      "points",
      dbgArray(
        this.points.map((p) => {
          if (this._version.compare(new AssetVersion(5, 0)) >= 0) {
            return dbgObject(
              dbgFields([
                ["point", dbgVec2(p.point)],
                ["vector", dbgVec2(p.vector as [number, number])],
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
