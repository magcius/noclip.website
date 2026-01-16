import type { vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import type { DataStream } from "../Common";
import { type DebugInfo, dbgNum } from "./debug";
import { PiecewiseCurve } from "./PiecewiseCurve";
import { type CopyContext, registerTypedObject } from "./TypedObject";

export interface NurbsCV {
  point: vec4;
  t: number;
}

/**
 * NURBS curve with control vertices.
 */
export class NurbsCurve extends PiecewiseCurve {
  public order = 0;
  public cvs: NurbsCV[] = [];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    this.order = data.readUint8();

    const numCvs = data.readUint32();
    for (let i = 0; i < numCvs; i++) {
      const point = data.readVec4();
      const t = data.readFloat64();
      this.cvs.push({ point, t });
    }
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.order = this.order;
    target.cvs = this.cvs;
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("order", dbgNum(this.order));
    info.set("cvs", dbgNum(this.cvs.length));
    return info;
  }
}

registerTypedObject("NurbsCurve", NurbsCurve);
registerTypedObject("ClassicNurbsCurve", NurbsCurve);
