import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { registerBAMObject } from "./base";
import { AnimGroup } from "./AnimGroup";
import { type DebugInfo, dbgBool, dbgNum } from "./debug";

// Matrix component indices (12 total for a 4x3 affine transform)
// i, j, k = scale
// a, b, c = shear
// h, p, r = rotation (HPR angles)
// x, y, z = translation
const NUM_MATRIX_COMPONENTS = 12;

/**
 * AnimChannelMatrixXfmTable - Matrix animation channel with transform tables
 *
 * Stores per-frame transform data as separate tables for each component:
 * scale (i,j,k), shear (a,b,c), rotation (h,p,r), translation (x,y,z)
 *
 * Version differences:
 * - BAM < 4.14: No new_hpr flag
 * - BAM >= 4.14: Has new_hpr flag for HPR format conversion
 */
export class AnimChannelMatrixXfmTable extends AnimGroup {
	public lastFrame: number = 0;
	public tables: Float32Array[] = [];
	public compressed: boolean = false;
	public newHpr: boolean = false;

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		// AnimChannelBase::fillin
		this.lastFrame = data.readUint16();

		// AnimChannelMatrixXfmTable::fillin
		this.compressed = data.readBool();

		// BAM 4.14+ has new_hpr flag
		if (file.header.version.compare(new AssetVersion(4, 14)) >= 0) {
			this.newHpr = data.readBool();
		}

		if (!this.compressed) {
			// Read uncompressed table data
			for (let i = 0; i < NUM_MATRIX_COMPONENTS; i++) {
				const size = data.readUint16();
				const table = new Float32Array(size);
				for (let j = 0; j < size; j++) {
					table[j] = data.readFloat32();
				}
				this.tables.push(table);
			}
		} else {
			// Compressed format uses FFTCompressor - skip for now
			// Just read the raw bytes to advance the stream
			// This is complex and rarely used in Toontown
			throw new Error("Compressed animation channels not yet supported");
		}
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();
		info.set("lastFrame", dbgNum(this.lastFrame));
		info.set("compressed", dbgBool(this.compressed));
		const nonEmptyTables = this.tables.filter((t) => t.length > 0).length;
		info.set("tables", dbgNum(nonEmptyTables));
		return info;
	}
}

registerBAMObject("AnimChannelMatrixXfmTable", AnimChannelMatrixXfmTable);
