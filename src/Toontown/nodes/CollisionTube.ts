import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { CollisionSolid } from "./CollisionSolid";
import { type DebugInfo, dbgNum, dbgVec3 } from "./debug";

/**
 * CollisionTube - Capsule collision shape
 *
 * Renamed to CollisionCapsule in BAM 6.44, but the format is identical.
 */
export class CollisionTube extends CollisionSolid {
	public pointA: [number, number, number] = [0, 0, 0];
	public pointB: [number, number, number] = [0, 0, 0];
	public radius: number = 0;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.pointA = data.readVec3();
		this.pointB = data.readVec3();
		this.radius = data.readFloat32();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("pointA", dbgVec3(this.pointA));
		info.set("pointB", dbgVec3(this.pointB));
		info.set("radius", dbgNum(this.radius));
		return info;
	}
}

registerBAMObject("CollisionTube", CollisionTube);
registerBAMObject("CollisionCapsule", CollisionTube);
