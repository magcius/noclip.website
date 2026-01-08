import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgFlags, dbgVec3, dbgVec4 } from "./debug";

// CollisionSolid flags
const F_EFFECTIVE_NORMAL = 1 << 1;

const CollisionSolidFlags = {
	Tangible: 1 << 0,
	EffectiveNormal: F_EFFECTIVE_NORMAL,
};

export class CollisionPlane extends BAMObject {
	// CollisionSolid fields
	public flags: number;
	public effectiveNormal: [number, number, number] = [0, 0, 0];

	// CollisionPlane fields
	public plane: [number, number, number, number];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		// Read CollisionSolid base
		this.flags = data.readUint8();
		if (this.flags & F_EFFECTIVE_NORMAL) {
			this.effectiveNormal = data.readVec3();
		}

		// Read CollisionPlane data
		this.plane = data.readVec4();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("flags", dbgFlags(this.flags, CollisionSolidFlags));
		if (this.flags & F_EFFECTIVE_NORMAL) {
			info.set("effectiveNormal", dbgVec3(this.effectiveNormal));
		}
		info.set("plane", dbgVec4(this.plane));
		return info;
	}
}

registerBAMObject("CollisionPlane", CollisionPlane);
