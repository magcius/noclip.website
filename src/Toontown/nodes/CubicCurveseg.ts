import { vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../util/DataStream";
import { type DebugInfo, dbgBool, dbgVec4 } from "./debug";
import { ParametricCurve } from "./ParametricCurve";
import { type CopyContext, registerTypedObject } from "./TypedObject";

/**
 * Cubic curve segment with 4 control points.
 */
export class CubicCurveseg extends ParametricCurve {
  public Bx = vec4.create();
  public By = vec4.create();
  public Bz = vec4.create();
  public Bw = vec4.create();
  public rational = false;

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);
    this.Bx = data.readVec4();
    this.By = data.readVec4();
    this.Bz = data.readVec4();
    this.Bw = data.readVec4();
    this.rational = data.readBool();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    vec4.copy(target.Bx, this.Bx);
    vec4.copy(target.By, this.By);
    vec4.copy(target.Bz, this.Bz);
    vec4.copy(target.Bw, this.Bw);
    target.rational = this.rational;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("Bx", dbgVec4(this.Bx));
    info.set("By", dbgVec4(this.By));
    info.set("Bz", dbgVec4(this.Bz));
    info.set("Bw", dbgVec4(this.Bw));
    info.set("rational", dbgBool(this.rational));
    return info;
  }
}

registerTypedObject("CubicCurveseg", CubicCurveseg);
