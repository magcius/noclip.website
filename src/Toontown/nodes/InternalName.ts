import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgStr } from "./debug";

export class InternalName extends BAMObject {
	public name: string;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);
		this.name = data.readString();
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("name", dbgStr(this.name));
		return info;
	}
}

registerBAMObject("InternalName", InternalName);

// TexCoordName is identical to InternalName in older BAM versions
registerBAMObject("TexCoordName", InternalName);
