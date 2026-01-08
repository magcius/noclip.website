import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { registerBAMObject } from "./base";
import { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgBool, dbgNum } from "./debug";

/**
 * AnimChannelScalarTable - Scalar animation channel with value table
 *
 * Stores per-frame scalar values (e.g., for morph sliders).
 */
export class AnimChannelScalarTable extends AnimGroup {
	public lastFrame: number = 0;
	public table: Float32Array = new Float32Array(0);
	public compressed: boolean = false;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		// AnimChannelBase::fillin
		this.lastFrame = data.readUint16();

		// AnimChannelScalarTable::fillin
		this.compressed = data.readBool();

		if (!this.compressed) {
			const size = data.readUint16();
			this.table = new Float32Array(size);
			for (let i = 0; i < size; i++) {
				this.table[i] = data.readFloat32();
			}
		} else {
			throw new Error("Compressed animation channels not yet supported");
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("lastFrame", dbgNum(this.lastFrame));
		info.set("values", dbgNum(this.table.length));
		return info;
	}
}

registerBAMObject("AnimChannelScalarTable", AnimChannelScalarTable);
