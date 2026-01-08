import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgBool, dbgVec4 } from "./debug";
import { ParametricCurve } from "./ParametricCurve";

/**
 * CubicCurveseg - Cubic curve segment with 4 control points
 */
export class CubicCurveseg extends ParametricCurve {
	public Bx: [number, number, number, number] = [0, 0, 0, 0];
	public By: [number, number, number, number] = [0, 0, 0, 0];
	public Bz: [number, number, number, number] = [0, 0, 0, 0];
	public Bw: [number, number, number, number] = [0, 0, 0, 0];
	public rational: boolean = false;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.Bx = data.readVec4();
		this.By = data.readVec4();
		this.Bz = data.readVec4();
		this.Bw = data.readVec4();
		this.rational = data.readBool();
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

registerBAMObject("CubicCurveseg", CubicCurveseg);
