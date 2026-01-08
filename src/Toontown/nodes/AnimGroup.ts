import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgRefs, dbgStr } from "./debug";

/**
 * AnimGroup - Base class for animation hierarchy nodes
 *
 * AnimGroup is the base for animation data:
 * - AnimBundle (extends AnimGroup with fps/frames)
 * - AnimChannelBase (extends AnimGroup with channel data)
 */
export class AnimGroup extends BAMObject {
	public name: string = "";
	public rootRef: number = 0; // Reference to containing AnimBundle
	public childRefs: number[] = [];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.name = data.readString();
		this.rootRef = data.readObjectId();

		const numChildren = data.readUint16();
		for (let i = 0; i < numChildren; i++) {
			this.childRefs.push(data.readObjectId());
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("name", dbgStr(this.name));
		info.set("children", dbgRefs(this.childRefs));
		return info;
	}
}

registerBAMObject("AnimGroup", AnimGroup);
