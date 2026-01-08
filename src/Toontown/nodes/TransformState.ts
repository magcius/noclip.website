import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import {
	type DebugInfo,
	dbgArray,
	dbgBool,
	dbgFlags,
	dbgNum,
	dbgVec3,
	dbgVec4,
} from "./debug";

// TransformState flags
const F_IS_IDENTITY = 0x00001;
const F_COMPONENTS_GIVEN = 0x00008;
const F_MATRIX_KNOWN = 0x00040;
const F_QUAT_GIVEN = 0x00100;

const TransformFlags = {
	Identity: F_IS_IDENTITY,
	ComponentsGiven: F_COMPONENTS_GIVEN,
	MatrixKnown: F_MATRIX_KNOWN,
	QuatGiven: F_QUAT_GIVEN,
};

export class TransformState extends BAMObject {
	public flags: number;
	public position: [number, number, number] = [0, 0, 0];
	public quaternion: [number, number, number, number] = [0, 0, 0, 1];
	public rotation: [number, number, number] = [0, 0, 0];
	public scale: [number, number, number] = [1, 1, 1];
	public shear: [number, number, number] = [0, 0, 0];
	public matrix: number[] = [];

	constructor(objectId: number, file: BAMFile, data: DataStream) {
		super(objectId, file, data);

		const version = file.header.version;

		// Flags changed from uint16 to uint32 in BAM 5.2
		if (version.compare(new AssetVersion(5, 2)) >= 0) {
			this.flags = data.readUint32();
		} else {
			this.flags = data.readUint16();
		}

		if (this.flags & F_COMPONENTS_GIVEN) {
			this.position = data.readVec3();

			if (this.flags & F_QUAT_GIVEN) {
				this.quaternion = data.readVec4();
			} else {
				this.rotation = data.readVec3();
			}

			this.scale = data.readVec3();

			// Shear was added in BAM 4.6, always present in BAM 5.0+
			if (
				version.compare(new AssetVersion(5, 0)) >= 0 ||
				(version.major === 4 && version.minor >= 6)
			) {
				this.shear = data.readVec3();
			}
		}

		if (this.flags & F_MATRIX_KNOWN) {
			this.matrix = data.readMat4();
		}
	}

	get isIdentity(): boolean {
		return (this.flags & F_IS_IDENTITY) !== 0;
	}

	override getDebugInfo(): DebugInfo {
		const info = super.getDebugInfo();

		if (this.isIdentity) {
			info.set("identity", dbgBool(true));
			return info;
		}

		info.set("flags", dbgFlags(this.flags, TransformFlags));

		if (this.flags & F_COMPONENTS_GIVEN) {
			info.set("position", dbgVec3(this.position));

			if (this.flags & F_QUAT_GIVEN) {
				info.set("quaternion", dbgVec4(this.quaternion));
			} else {
				info.set("rotation", dbgVec3(this.rotation));
			}

			const isUniformScale =
				this.scale[0] === this.scale[1] && this.scale[1] === this.scale[2];
			if (!isUniformScale || this.scale[0] !== 1) {
				info.set("scale", dbgVec3(this.scale));
			}

			const hasShear =
				this.shear[0] !== 0 || this.shear[1] !== 0 || this.shear[2] !== 0;
			if (hasShear) {
				info.set("shear", dbgVec3(this.shear));
			}
		}

		if (this.flags & F_MATRIX_KNOWN && this.matrix.length === 16) {
			info.set("matrix", dbgArray(this.matrix.map(dbgNum)));
		}

		return info;
	}
}

registerBAMObject("TransformState", TransformState);
