import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { PiecewiseCurve } from "./PiecewiseCurve";

export interface NurbsCV {
	point: [number, number, number, number]; // x, y, z, w
	t: number;
}

/**
 * NurbsCurve - NURBS curve with control vertices
 */
export class NurbsCurve extends PiecewiseCurve {
	public order: number = 0;
	public cvs: NurbsCV[] = [];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.order = data.readUint8();

		const numCvs = data.readUint32();
		for (let i = 0; i < numCvs; i++) {
			const point = data.readVec4();
			const t = data.readFloat64();
			this.cvs.push({ point, t });
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("order", dbgNum(this.order));
		info.set("cvs", dbgNum(this.cvs.length));
		return info;
	}
}

registerBAMObject("NurbsCurve", NurbsCurve);
registerBAMObject("ClassicNurbsCurve", NurbsCurve);
