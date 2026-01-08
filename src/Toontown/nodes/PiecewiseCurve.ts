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

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		const numSegs = data.readUint32();
		for (let i = 0; i < numSegs; i++) {
			const curveRef = data.readObjectId();
			const tend = data.readFloat64();
			this.segments.push({ curveRef, tend });
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("segments", dbgNum(this.segments.length));
		return info;
	}
}
