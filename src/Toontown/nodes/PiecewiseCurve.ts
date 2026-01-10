import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { type DebugInfo, dbgNum } from "./debug";
import { ParametricCurve } from "./ParametricCurve";

export interface CurveSeg {
  curveRef: number;
  tend: number;
}

/**
 * PiecewiseCurve - Curve made of segments
 */
export class PiecewiseCurve extends ParametricCurve {
  public segments: CurveSeg[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const numSegs = data.readUint32();
    for (let i = 0; i < numSegs; i++) {
      const curveRef = data.readObjectId();
      const tend = data.readFloat64();
      this.segments.push({ curveRef, tend });
    }
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.segments = this.segments; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("segments", dbgNum(this.segments.length));
    return info;
  }
}
