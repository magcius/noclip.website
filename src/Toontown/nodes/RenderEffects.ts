import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs } from "./debug";

export class RenderEffects extends BAMObject {
	public effectRefs: number[] = [];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		const numEffects = data.readUint16();
		for (let i = 0; i < numEffects; i++) {
			this.effectRefs.push(data.readObjectId());
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("effects", dbgRefs(this.effectRefs));
		return info;
	}
}

registerBAMObject("RenderEffects", RenderEffects);
