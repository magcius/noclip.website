import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgBytes, dbgEnum, dbgRef } from "./debug";
import { UsageHint } from "./geomEnums";

export class GeomVertexArrayData extends BAMObject {
	public arrayFormatRef: number;
	public usageHint: UsageHint;
	public buffer: Uint8Array;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.arrayFormatRef = data.readObjectId();

		// Cycler data
		this.usageHint = data.readUint8() as UsageHint;

		if (file.header.version.compare(new AssetVersion(6, 8)) >= 0) {
			const size = data.readUint32();
			this.buffer = data.readUint8Array(size);
		} else {
			// Very old format - PTA-based
			throw new Error(
				"BAM version < 6.8 not supported for GeomVertexArrayData",
			);
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("arrayFormatRef", dbgRef(this.arrayFormatRef));
		info.set("usageHint", dbgEnum(this.usageHint, UsageHint));
		info.set("buffer", dbgBytes(this.buffer.length));
		return info;
	}
}

registerBAMObject("GeomVertexArrayData", GeomVertexArrayData);
