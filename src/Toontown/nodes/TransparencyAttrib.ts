import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";

export enum TransparencyMode {
	None = 0,
	Alpha = 1,
	// Value 2 was previously used, now unused
	Multisample = 3,
	MultisampleMask = 4,
	Binary = 5,
	Dual = 6,
}

export class TransparencyAttrib extends BAMObject {
	public mode: TransparencyMode;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.mode = data.readUint8() as TransparencyMode;
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("mode", dbgEnum(this.mode, TransparencyMode));
		return info;
	}
}

registerBAMObject("TransparencyAttrib", TransparencyAttrib);
