import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import type { DebugInfo } from "./debug";

/**
 * DecalEffect - Marks a node as a decal (renders on top of parent)
 *
 * This effect has no additional data - its presence alone indicates
 * the decal behavior should be applied.
 */
export class DecalEffect extends BAMObject {
	// biome-ignore lint/complexity/noUselessConstructor: ignored
	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);
		// DecalEffect has no additional fields
	}

	override getDebugInfo(): DebugInfo {
		return super.getDebugInfo();
	}
}

registerBAMObject("DecalEffect", DecalEffect);
