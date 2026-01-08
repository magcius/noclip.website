import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum } from "./debug";

/**
 * TextureApplyAttrib - Legacy texture apply mode (pre-5.0)
 *
 * This was replaced by TextureStage in BAM 5.0+
 */
export enum TextureApplyMode {
	Modulate = 0,
	Decal = 1,
	Blend = 2,
	Replace = 3,
	Add = 4,
}

export class TextureApplyAttrib extends BAMObject {
	public mode: TextureApplyMode = TextureApplyMode.Modulate;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);
		this.mode = data.readUint8() as TextureApplyMode;
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("mode", dbgEnum(this.mode, TextureApplyMode));
		return info;
	}
}

registerBAMObject("TextureApplyAttrib", TextureApplyAttrib);
