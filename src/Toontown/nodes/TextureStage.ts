import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
	type DebugInfo,
	dbgBool,
	dbgColor,
	dbgEnum,
	dbgNum,
	dbgObject,
	dbgRef,
	dbgStr,
} from "./debug";

export enum TextureStageMode {
	Modulate = 0,
	Decal = 1,
	Blend = 2,
	Replace = 3,
	Add = 4,
	Combine = 5,
	BlendColorScale = 6,
	ModulateGlow = 7,
	ModulateGloss = 8,
	Normal = 9,
	NormalHeight = 10,
	Glow = 11,
	Gloss = 12,
	Height = 13,
	Selector = 14,
	NormalGloss = 15,
	Emission = 16,
}

export enum CombineMode {
	Undefined = 0,
	Replace = 1,
	Modulate = 2,
	Add = 3,
	AddSigned = 4,
	Interpolate = 5,
	Subtract = 6,
	DotProduct3RGB = 7,
	DotProduct3RGBA = 8,
}

export enum CombineSource {
	Undefined = 0,
	Texture = 1,
	Constant = 2,
	PrimaryColor = 3,
	Previous = 4,
	ConstantColorScale = 5,
	LastSavedResult = 6,
}

export enum CombineOperand {
	Undefined = 0,
	SourceColor = 1,
	OneMinusSourceColor = 2,
	SourceAlpha = 3,
	OneMinusSourceAlpha = 4,
}

interface CombineConfig {
	mode: CombineMode;
	numOperands: number;
	sources: [CombineSource, CombineSource, CombineSource];
	operands: [CombineOperand, CombineOperand, CombineOperand];
}

function readCombineConfig(data: DataStream): CombineConfig {
	const mode = data.readUint8() as CombineMode;
	const numOperands = data.readUint8();
	const sources: [CombineSource, CombineSource, CombineSource] = [
		data.readUint8() as CombineSource,
		data.readUint8() as CombineSource,
		data.readUint8() as CombineSource,
	];
	const operands: [CombineOperand, CombineOperand, CombineOperand] = [
		data.readUint8() as CombineOperand,
		data.readUint8() as CombineOperand,
		data.readUint8() as CombineOperand,
	];
	return { mode, numOperands, sources, operands };
}

function combineConfigDebugInfo(config: CombineConfig): DebugInfo {
	const info: DebugInfo = new Map();
	info.set("mode", dbgEnum(config.mode, CombineMode));
	for (let i = 0; i < config.numOperands; i++) {
		info.set(`source${i}`, dbgEnum(config.sources[i], CombineSource));
		info.set(`operand${i}`, dbgEnum(config.operands[i], CombineOperand));
	}
	return info;
}

export class TextureStage extends BAMObject {
	public name: string = "";
	public sort: number = 0;
	public priority: number = 0;
	public texcoordNameRef: number | null = null;
	public mode: TextureStageMode = TextureStageMode.Modulate;
	public color: [number, number, number, number] = [0, 0, 0, 1];
	public rgbScale: number = 1;
	public alphaScale: number = 1;
	public savedResult: boolean = false;
	public texViewOffset: number = 0;
	public combineRgb: CombineConfig;
	public combineAlpha: CombineConfig;
	public isDefault: boolean = false;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		// Default combine config
		const defaultCombine: CombineConfig = {
			mode: CombineMode.Undefined,
			numOperands: 0,
			sources: [
				CombineSource.Undefined,
				CombineSource.Undefined,
				CombineSource.Undefined,
			],
			operands: [
				CombineOperand.Undefined,
				CombineOperand.Undefined,
				CombineOperand.Undefined,
			],
		};
		this.combineRgb = { ...defaultCombine };
		this.combineAlpha = { ...defaultCombine };

		// Check if this is the default stage
		this.isDefault = data.readBool();
		if (this.isDefault) {
			return;
		}

		// Read stage properties
		this.name = data.readString();
		this.sort = data.readInt32();
		this.priority = data.readInt32();

		// texcoord_name is a pointer to InternalName
		const texcoordRef = data.readObjectId();
		if (texcoordRef !== 0) {
			this.texcoordNameRef = texcoordRef;
		}

		this.mode = data.readUint8() as TextureStageMode;
		this.color = data.readVec4();
		this.rgbScale = data.readUint8();
		this.alphaScale = data.readUint8();
		this.savedResult = data.readBool();

		// tex_view_offset added in version 6.26
		if (file.header.version.compare(new AssetVersion(6, 26)) >= 0) {
			this.texViewOffset = data.readInt32();
		}

		// Read combine configurations
		this.combineRgb = readCombineConfig(data);
		this.combineAlpha = readCombineConfig(data);
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();

		if (this.isDefault) {
			info.set("default", dbgBool(true));
			return info;
		}

		if (this.name !== "") {
			info.set("name", dbgStr(this.name));
		}
		if (this.sort !== 0) {
			info.set("sort", dbgNum(this.sort));
		}
		if (this.priority !== 0) {
			info.set("priority", dbgNum(this.priority));
		}
		if (this.texcoordNameRef !== null) {
			info.set("texcoordNameRef", dbgRef(this.texcoordNameRef));
		}

		info.set("mode", dbgEnum(this.mode, TextureStageMode));

		// Only show color if not default (black with alpha 1)
		if (
			this.color[0] !== 0 ||
			this.color[1] !== 0 ||
			this.color[2] !== 0 ||
			this.color[3] !== 1
		) {
			info.set("color", dbgColor(this.color));
		}

		if (this.rgbScale !== 1) {
			info.set("rgbScale", dbgNum(this.rgbScale));
		}
		if (this.alphaScale !== 1) {
			info.set("alphaScale", dbgNum(this.alphaScale));
		}
		if (this.savedResult) {
			info.set("savedResult", dbgBool(true));
		}
		if (this.texViewOffset !== 0) {
			info.set("texViewOffset", dbgNum(this.texViewOffset));
		}

		// Only show combine configs if using Combine mode
		if (this.mode === TextureStageMode.Combine) {
			if (this.combineRgb.mode !== CombineMode.Undefined) {
				info.set("combineRgb", dbgObject(combineConfigDebugInfo(this.combineRgb), true));
			}
			if (this.combineAlpha.mode !== CombineMode.Undefined) {
				info.set("combineAlpha", dbgObject(combineConfigDebugInfo(this.combineAlpha), true));
			}
		}

		return info;
	}
}

registerBAMObject("TextureStage", TextureStage);
