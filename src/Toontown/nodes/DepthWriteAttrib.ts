import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";

export enum DepthWriteMode {
	Off = 0,
	On = 1,
}

export class DepthWriteAttrib extends BAMObject {
	public mode: DepthWriteMode = DepthWriteMode.On;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);
		this.mode = data.readUint8() as DepthWriteMode;
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("mode", dbgEnum(this.mode, DepthWriteMode));
		return info;
	}
}

registerBAMObject("DepthWriteAttrib", DepthWriteAttrib);
