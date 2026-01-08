import type { BAMFile } from "../bam";
import type { DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgColor, dbgEnum } from "./debug";

export enum ColorType {
	Vertex = 0,
	Flat = 1,
	Off = 2,
}

export class ColorAttrib extends BAMObject {
	public colorType: ColorType;
	public color: [number, number, number, number];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		this.colorType = data.readUint8() as ColorType;
		this.color = data.readVec4();

		// Quantize color based on type
		this.quantizeColor();
	}

	private quantizeColor(): void {
		switch (this.colorType) {
			case ColorType.Vertex:
				this.color = [0, 0, 0, 0];
				break;
			case ColorType.Flat: {
				const SCALE = 1024.0;
				this.color = [
					Math.floor(this.color[0] * SCALE + 0.5) / SCALE,
					Math.floor(this.color[1] * SCALE + 0.5) / SCALE,
					Math.floor(this.color[2] * SCALE + 0.5) / SCALE,
					Math.floor(this.color[3] * SCALE + 0.5) / SCALE,
				];
				break;
			}
			case ColorType.Off:
				this.color = [1, 1, 1, 1];
				break;
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("colorType", dbgEnum(this.colorType, ColorType));
		if (this.colorType === ColorType.Flat) {
			info.set("color", dbgColor(this.color));
		}
		return info;
	}
}

registerBAMObject("ColorAttrib", ColorAttrib);
