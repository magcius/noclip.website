import { SCX } from "./types.js";
import { sanitizeMesh } from "./sanitize_mesh.js";
import { Token, tokenTable, closeBrace, openBrace } from "./tokens.js"
import { range } from "../../MathHelpers.js";
import { splitMesh } from "./split_mesh.js";

const littleEndian = (() => {
	const buffer = new ArrayBuffer(2);
	new DataView(buffer).setInt16(0, 256, true);
	return new Int16Array(buffer)[0] === 256;
})();

const toDataView = (bytes: Uint8Array) => new DataView(
	bytes.buffer,
	bytes.byteOffset,
	bytes.byteLength,
);

const dataParsersByTokenName:Record<string, (bytes: Uint8Array) => (number | string)> = {
	"STRING": bytes => [...bytes].map((c) => String.fromCharCode(c)).join(""),
	"NUMBERLIST": bytes => toDataView(bytes).getFloat32(0, littleEndian),
	"NUMBER": bytes => toDataView(bytes).getFloat32(0, littleEndian),
	"INTEGER": bytes => toDataView(bytes).getInt32(0, littleEndian),
	"BYTE": bytes => toDataView(bytes).getInt8(0),
	"UNSIGNEDBYTE": bytes => toDataView(bytes).getUint8(0),
	"WORD": bytes => toDataView(bytes).getInt16(0, littleEndian),
	"UNSIGNEDWORD": bytes => toDataView(bytes).getUint16(0, littleEndian),
};

const parseDataType = (bytes: Uint8Array, token: Token) : string | number => {
	let { name } = token;
	const dataParser = dataParsersByTokenName[name];
	if (dataParser == null) {
		console.warn("Unsupported data type:", token.name);
		return `${name}(${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")})`;
	}
	return dataParser(bytes);
};

const typedListNames: Record<string, string> = {
	"scene": "globals",
	"mesh": "meshes",
	"normals": "normals",
	"uvcoords": "texCoords",
	"vertexpoints": "positions",
	"keys": "keyframes",
	"anim": "animations"
};

export const parse = async (scxBytes: Uint8Array) : Promise<SCX.Scene> => {
	const writer = new Writer();
	const len = scxBytes.length;
	for (let i = 0; i < len; i++) {
		const byte = scxBytes[i];
		const token = tokenTable[byte];
		const lastToken = tokenTable[i > 0 ? scxBytes[i - 1] : -1];

		if (token?.type === "data-type") {
			const values: (string | number)[] = [];
			const { terminator, vec, size } = token;
			if (terminator != null) {
				const end = scxBytes.indexOf(terminator, i);
				const bytes = scxBytes.subarray(i + 1, end);
				i = end;
				values.push(parseDataType(bytes, token));
			} else {
				let isAtEndOfList = false;
				while (!isAtEndOfList) {
					let count = 1;
					if (vec) {
						i++;
						count = scxBytes[i];
					}
					for (let j = 0; j < count; j++) {
						const numBytes = size ?? 1;
						const bytes = scxBytes.subarray(i + 1, i + 1 + numBytes);
						i += numBytes;
						values.push(parseDataType(bytes, token));
					}

					isAtEndOfList = true;
					if (count >= 0xff) {
						const nextToken = tokenTable[scxBytes[i + 1]];
						if (nextToken === token) {
							i++;
							isAtEndOfList = false;
						}
					}
				}
			}
			writer.writeValues(values);
			continue;
		}

		if (token == null) {
			console.warn("No token:", byte);
			continue;
		}

		if (token?.name === openBrace) {
			writer.incrementIndent();
			continue;
		}

		if (token?.name === closeBrace) {
			writer.decrementIndent();
			continue;
		}

		const isValue = token.type === "value" && lastToken != null; // probably should be more rigorous
		const isFieldName =
			!isValue && tokenTable[scxBytes[i + 1]]?.name !== openBrace;
		if (isValue) {
			writer.writeValue(token.name);
		} else if (isFieldName) {
			writer.writeFieldName(token.name);
		} else {
			writer.writeObjectType(token.name);
		}
	}

	return writer.print();
};

class Writer {
	scopeStack:any[] = [{}]; // TODO: improve type
	fieldName: string | null = null;

	stackTop = () => this.scopeStack[Math.max(0, this.scopeStack.length - 1)]

	writeValues(values: (string | number)[]) {
		if (this.fieldName == null) {
			if (!Array.isArray(this.stackTop())) {
				const o = this.scopeStack.pop();
				this.stackTop().pop();
			}
			this.stackTop().push(...values);
			return;
		}
		const oldValue = this.stackTop()[this.fieldName];
		if (oldValue != null) {
			const array = Array.isArray(oldValue) ? oldValue : [oldValue];
			array.push(...values);
			this.stackTop()[this.fieldName] = array;
		} else if (values.length === 1) {
			this.stackTop()[this.fieldName] = values[0];
		} else {
			this.stackTop()[this.fieldName] = values.slice();
		}
	};

	incrementIndent() {};

	decrementIndent() {
		const o = this.scopeStack.pop();
		if (!Array.isArray(o)) {
			this.scopeStack.pop();
		}
		this.fieldName = null;
	};

	writeValue(value: any) {
		if (this.fieldName == null) {
			console.warn("Dropped value:", value)
			return
		}
		if (typeof value === "string") {
			value = value.toLowerCase();
			if (value === "true") {
				value = true;
			} else if (value === "false") {
				value = false;
			}
		}
		this.stackTop()[this.fieldName] = value;
		this.fieldName = null;
	};

	writeFieldName(name: string) {
		this.fieldName = name.toLowerCase();
	};

	writeObjectType(type: string) {
		type = type.toLowerCase();
		const pluralTypeName = typedListNames[type] ?? `${type}s`;
		this.fieldName = null;
		if (this.stackTop()[pluralTypeName] == null) {
			this.stackTop()[pluralTypeName] = [];
		}
		this.scopeStack.push(this.stackTop()[pluralTypeName]);
		const o = {};
		this.stackTop().push(o);
		this.scopeStack.push(o);
	};

	crawlObject = (o: Record<string, any>, func: (o: Record<string, any>) => void) => {
		for (const key in o) {
			if (typeof o[key] === "object") {
				this.crawlObject(o[key], func);
			}
		}
		func(o);
	};

	print () : SCX.Scene {
		const o = this.scopeStack[0];
		this.crawlObject(o, (o: Record<string, any>) => {
			if (o.meshes != null && o.transforms != null) {
				const scale = (o.transforms.find(() => true) as SCX.Transform)!.scale;
				// For now, we only test whether an object is flipped in object space.
				// It might be worth testing whether an object is flipped in world space.
				const isFlipped = Math.sign(scale[0] * scale[1] * scale[2]) < 0;
				const meshes = [];
				for (const mesh of Object.values(o.meshes) as SCX.PolygonMesh[]) {
					if (mesh.polycount != null && mesh.polygons != null) {
						meshes.push(...splitMesh(mesh));
					}
				}
				meshes.forEach(mesh => sanitizeMesh(mesh, isFlipped));
				o.meshes = meshes;
			}
			
			if (o.keycount != null && o.keyframes != null) {
				const keyframes: Keyframe[] = range(0, o.keycount)
					.map((i) : Keyframe => {
						const [time, value, tangentIn, tangentOut] = o.keyframes.slice(
							i * 4,
							(i + 1) * 4,
						);
						return { time, value, tangentIn, tangentOut };
					});
				delete o.keycount;
				o.keyframes = keyframes;
			}
		});
		const scene: SCX.Scene = {
			shaders: [],
			scenes: [],
			cameras: [],
			lights: [],
			objects: [],
			...o
		};
		return scene;
	};
}