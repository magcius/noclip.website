import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgNum, dbgVec3 } from "./debug";

export class CollisionSphere extends CollisionSolid {
	public center: [number, number, number] = [0, 0, 0];
	public radius: number = 0;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.center = data.readVec3();
		this.radius = data.readFloat32();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("center", dbgVec3(this.center));
		info.set("radius", dbgNum(this.radius));
		return info;
	}
}

registerBAMObject("CollisionSphere", CollisionSphere);
