import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { type DebugInfo, dbgRef } from "./debug";
import { PandaNode } from "./PandaNode";

/**
 * AnimBundleNode - Node that holds an AnimBundle
 *
 * This is a PandaNode that contains a reference to an AnimBundle,
 * allowing animation data to be part of the scene graph.
 */
export class AnimBundleNode extends PandaNode {
	public bundleRef: number = 0;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);
		this.bundleRef = data.readObjectId();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("bundleRef", dbgRef(this.bundleRef));
		return info;
	}
}

registerBAMObject("AnimBundleNode", AnimBundleNode);
