import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { type DebugInfo, dbgEnum, dbgNum } from "./debug";
import { PandaNode } from "./PandaNode";

export enum CurveType {
  None = 0,
  Bezier = 1,
  Nurbs = 2,
  Hermite = 3,
}

/**
 * Base class for parametric curves.
 */
export class ParametricCurve extends PandaNode {
  public curveType = CurveType.None;
  public numDimensions = 3;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.curveType = data.readUint8() as CurveType;
    this.numDimensions = data.readUint8();
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.curveType = this.curveType;
    target.numDimensions = this.numDimensions;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("curveType", dbgEnum(this.curveType, CurveType));
    info.set("numDimensions", dbgNum(this.numDimensions));
    return info;
  }
}
