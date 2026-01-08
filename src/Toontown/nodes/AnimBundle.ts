import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgNum } from "./debug";

/**
 * AnimBundle - Root of an animation hierarchy
 *
 * Contains the base frame rate and frame count for an animation.
 */
export class AnimBundle extends AnimGroup {
	public fps: number = 0;
	public numFrames: number = 0;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.fps = data.readFloat32();
		this.numFrames = data.readUint16();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("fps", dbgNum(this.fps));
		info.set("numFrames", dbgNum(this.numFrames));
		return info;
	}
}

registerBAMObject("AnimBundle", AnimBundle);
