import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgNum } from "./debug";

// GeomBindType from old Panda3D
export enum GeomBindType {
	Off = 0,
	Overall = 1,
	PerPrim = 2,
	PerComponent = 3,
	PerVertex = 4,
}

// GeomAttrType indices
const G_COORD = 0;
const G_COLOR = 1;
const G_NORMAL = 2;
const G_TEXCOORD = 3;

/**
 * TexCoordDef - texture coordinate set for multitexture (BAM 4.11+)
 */
export interface TexCoordDef {
	nameRef: number; // Reference to TexCoordName object
	texcoords: Array<[number, number]>;
	tindex: number[];
}

/**
 * LegacyGeom - Pre-5.0 BAM geometry format
 *
 * This is the old Geom class that was replaced in BAM 5.0 with the
 * new Geom/GeomPrimitive system. The old format stored vertex data
 * directly in the Geom object rather than in separate GeomVertexData.
 *
 * Version differences:
 * - BAM < 4.11: Single texcoords/tindex arrays
 * - BAM >= 4.11: Multiple named texture coordinate sets (multitexture)
 */
export class LegacyGeom extends BAMObject {
	// Vertex attribute arrays
	public coords: Array<[number, number, number]> = [];
	public norms: Array<[number, number, number]> = [];
	public colors: Array<[number, number, number, number]> = [];
	public texcoords: Array<[number, number]> = []; // Default texcoords (for < 4.11 or default set)

	// Index arrays
	public vindex: number[] = [];
	public nindex: number[] = [];
	public cindex: number[] = [];
	public tindex: number[] = []; // Default tindex (for < 4.11 or default set)

	// Multitexture support (BAM 4.11+)
	public texcoordSets: TexCoordDef[] = [];

	// Primitive info
	public numPrims: number = 0;
	public primLengths: number[] = [];

	// Bindings for each attribute type
	public bindings: [GeomBindType, GeomBindType, GeomBindType, GeomBindType] = [
		GeomBindType.Off,
		GeomBindType.Off,
		GeomBindType.Off,
		GeomBindType.Off,
	];

	// Global PTA cache shared across all objects in the BAM file
	// This is necessary because PTAs can be shared between objects
	// (e.g., ComputedVertices shares coords with Geom)
	private static _ptaCache: Map<number, unknown> = new Map();

	/**
	 * Reset the global PTA cache. Should be called at the start of parsing a new BAM file.
	 */
	static resetPtaCache(): void {
		LegacyGeom._ptaCache.clear();
	}

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		const isMultitexture =
			file.header.version.compare(new AssetVersion(4, 11)) >= 0;

		// Read coords PTA (Vec3[])
		this.coords = LegacyGeom.readPtaVec3Global(data);

		// Read norms PTA (Vec3[])
		this.norms = LegacyGeom.readPtaVec3Global(data);

		// Read colors PTA (Vec4[])
		this.colors = LegacyGeom.readPtaVec4Global(data);

		// Read texture coordinates
		if (!isMultitexture) {
			// BAM < 4.11: Single texcoords PTA
			this.texcoords = LegacyGeom.readPtaVec2Global(data);
		} else {
			// BAM 4.11+: Multiple named texture coordinate sets
			const numTexcoordSets = data.readUint8();
			for (let i = 0; i < numTexcoordSets; i++) {
				const nameRef = data.readObjectId();
				const texcoords = LegacyGeom.readPtaVec2Global(data);
				const tindex = LegacyGeom.readPtaUshortGlobal(data);
				this.texcoordSets.push({ nameRef, texcoords, tindex });
			}
			// Use first set as default texcoords for compatibility
			if (this.texcoordSets.length > 0) {
				this.texcoords = this.texcoordSets[0].texcoords;
				this.tindex = this.texcoordSets[0].tindex;
			}
		}

		// Read index arrays (ushort[])
		this.vindex = LegacyGeom.readPtaUshortGlobal(data);
		this.nindex = LegacyGeom.readPtaUshortGlobal(data);
		this.cindex = LegacyGeom.readPtaUshortGlobal(data);

		// BAM < 4.11: tindex comes after cindex
		// BAM >= 4.11: tindex is part of each texcoord set (already read above)
		if (!isMultitexture) {
			this.tindex = LegacyGeom.readPtaUshortGlobal(data);
		}

		// Read numprims
		this.numPrims = data.readUint16();

		// Read primlengths PTA (int32[])
		this.primLengths = LegacyGeom.readPtaIntGlobal(data);

		// Read bindings (4 x uint8)
		this.bindings = [
			data.readUint8() as GeomBindType, // G_COORD
			data.readUint8() as GeomBindType, // G_COLOR
			data.readUint8() as GeomBindType, // G_NORMAL
			data.readUint8() as GeomBindType, // G_TEXCOORD
		];
	}

	static readPtaVec3Global(data: DataStream): Array<[number, number, number]> {
		const ptaId = data.readUint16();
		if (ptaId !== 0 && LegacyGeom._ptaCache.has(ptaId)) {
			return LegacyGeom._ptaCache.get(ptaId) as Array<[number, number, number]>;
		}
		const size = data.readUint32();
		const result: Array<[number, number, number]> = [];
		for (let i = 0; i < size; i++) {
			result.push(data.readVec3());
		}
		if (ptaId !== 0) {
			LegacyGeom._ptaCache.set(ptaId, result);
		}
		return result;
	}

	static readPtaVec4Global(data: DataStream): Array<[number, number, number, number]> {
		const ptaId = data.readUint16();
		if (ptaId !== 0 && LegacyGeom._ptaCache.has(ptaId)) {
			return LegacyGeom._ptaCache.get(ptaId) as Array<[number, number, number, number]>;
		}
		const size = data.readUint32();
		const result: Array<[number, number, number, number]> = [];
		for (let i = 0; i < size; i++) {
			result.push(data.readVec4());
		}
		if (ptaId !== 0) {
			LegacyGeom._ptaCache.set(ptaId, result);
		}
		return result;
	}

	static readPtaVec2Global(data: DataStream): Array<[number, number]> {
		const ptaId = data.readUint16();
		if (ptaId !== 0 && LegacyGeom._ptaCache.has(ptaId)) {
			return LegacyGeom._ptaCache.get(ptaId) as Array<[number, number]>;
		}
		const size = data.readUint32();
		const result: Array<[number, number]> = [];
		for (let i = 0; i < size; i++) {
			result.push(data.readVec2());
		}
		if (ptaId !== 0) {
			LegacyGeom._ptaCache.set(ptaId, result);
		}
		return result;
	}

	static readPtaUshortGlobal(data: DataStream): number[] {
		const ptaId = data.readUint16();
		if (ptaId !== 0 && LegacyGeom._ptaCache.has(ptaId)) {
			return LegacyGeom._ptaCache.get(ptaId) as number[];
		}
		const size = data.readUint32();
		const result: number[] = [];
		for (let i = 0; i < size; i++) {
			result.push(data.readUint16());
		}
		if (ptaId !== 0) {
			LegacyGeom._ptaCache.set(ptaId, result);
		}
		return result;
	}

	static readPtaIntGlobal(data: DataStream): number[] {
		const ptaId = data.readUint16();
		if (ptaId !== 0 && LegacyGeom._ptaCache.has(ptaId)) {
			return LegacyGeom._ptaCache.get(ptaId) as number[];
		}
		const size = data.readUint32();
		const result: number[] = [];
		for (let i = 0; i < size; i++) {
			result.push(data.readInt32());
		}
		if (ptaId !== 0) {
			LegacyGeom._ptaCache.set(ptaId, result);
		}
		return result;
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("coords", dbgNum(this.coords.length));
		info.set("norms", dbgNum(this.norms.length));
		info.set("colors", dbgNum(this.colors.length));
		info.set("texcoords", dbgNum(this.texcoords.length));
		info.set("numPrims", dbgNum(this.numPrims));
		info.set("coordBind", dbgEnum(this.bindings[G_COORD], GeomBindType));
		info.set("colorBind", dbgEnum(this.bindings[G_COLOR], GeomBindType));
		info.set("normalBind", dbgEnum(this.bindings[G_NORMAL], GeomBindType));
		info.set("texcoordBind", dbgEnum(this.bindings[G_TEXCOORD], GeomBindType));
		return info;
	}
}

// Register all old-style Geom types
registerBAMObject("GeomTri", LegacyGeom);
registerBAMObject("GeomTristrip", LegacyGeom);
registerBAMObject("GeomTrifan", LegacyGeom);
registerBAMObject("GeomLine", LegacyGeom);
registerBAMObject("GeomLinestrip", LegacyGeom);
registerBAMObject("GeomPoint", LegacyGeom);
registerBAMObject("GeomSprite", LegacyGeom);
