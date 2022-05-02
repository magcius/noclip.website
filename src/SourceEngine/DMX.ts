
import { mat4, quat, vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { colorNewFromRGBA, colorNewFromRGBA8 } from "../Color";
import { assert, assertExists, readString } from "../util";

export interface DMXAttribute {
    name: string;
    type: number;
    value: any;
}

export interface DMXElement {
    type: string;
    name: string;
    attributes: DMXAttribute[];
}

export const enum DMXAttributeType {
    Element = 1,
    Int,
    Float,
    Bool,
    String,
    Void,
    Time,
    Color,
    Vector2,
    Vector3,
    Vector4,
    QAngle,
    Quaternion,
    VMatrix,

    ElementArray,
    IntArray,
    FloatArray,
    BoolArray,
    StringArray,
    VoidArray,
    TimeArray,
    ColorArray,
    Vector2Array,
    Vector3Array,
    Vector4Array,
    QAngleArray,
    QuaternionArray,
    VMatrixArray,

    FirstType = Element,
    FirstArrayType = ElementArray,
}

export interface DMXFile {
    magic: string;
    subversion: number;
    rootElement: DMXElement;
}

export function parse(buffer: ArrayBufferSlice): DMXFile {
    const view = buffer.createDataView();

    const stringTable: string[] = [];
    const elements: DMXElement[] = [];

    let offs = 0;

    const magicHeader = readStr(false);
    assert(magicHeader.startsWith(`<!-- dmx encoding binary `));
    const versionStr = magicHeader.slice(`<!-- dmx encoding binary `.length).split(' ')[0];
    const version = Number(versionStr);
    assert(version >= 2);
    assert(magicHeader.startsWith(`<!-- dmx encoding binary ${version} format `));
    const [magic, subversionStr] = magicHeader.slice(`<!-- dmx encoding binary ${version} format `.length).split(' ');
    const subversion = Number(subversionStr);

    function readUint16(): number {
        const value = view.getUint16(offs + 0x00, true);
        offs += 0x02;
        return value;
    }

    function readUint32(): number {
        const value = view.getUint32(offs + 0x00, true);
        offs += 0x04;
        return value;
    }

    function readFloat32(): number {
        const value = view.getFloat32(offs + 0x00, true);
        offs += 0x04;
        return value;
    }

    function readStr(isTable: boolean): string {
        if (isTable) {
            assert(version >= 2);
            const index = version >= 5 ? readUint32() : readUint16();
            return stringTable[index];
        } else {
            const str = readString(buffer, offs);
            offs += str.length + 1;
            return str;
        }
    }

    function parseAttribute(type: DMXAttributeType, isArray: boolean = false): any {
        if (type >= DMXAttributeType.FirstArrayType) {
            const arrayValueType = type - DMXAttributeType.FirstArrayType + DMXAttributeType.FirstType;
            const array: any[] = [];
            const arrayCount = readUint32();
            for (let i = 0; i < arrayCount; i++) {
                const arrayValue = parseAttribute(arrayValueType, true);
                array.push(arrayValue);
            }
            return array;
        }

        if (type === DMXAttributeType.Element) {
            const elemIndex = readUint32();
            return assertExists(elements[elemIndex]);
        } else if (type === DMXAttributeType.Int) {
            return readUint32();
        } else if (type === DMXAttributeType.Float) {
            return readFloat32();
        } else if (type === DMXAttributeType.Bool) {
            return !!view.getUint8(offs++);
        } else if (type === DMXAttributeType.String) {
            const isStringTable = version >= 4 && !isArray;
            return readStr(isStringTable);
        } else if (type === DMXAttributeType.Void) {
            const blobSize = readUint32();
            const startOffs = offs;
            offs += blobSize;
            return buffer.subarray(startOffs, blobSize);
        } else if (type === DMXAttributeType.Time) {
            return readUint32() / 10000;
        } else if (type === DMXAttributeType.Color) {
            const r = view.getUint8(offs + 0x00) / 0xFF;
            const g = view.getUint8(offs + 0x01) / 0xFF;
            const b = view.getUint8(offs + 0x02) / 0xFF;
            const a = view.getUint8(offs + 0x03) / 0xFF;
            offs += 0x04;
            return colorNewFromRGBA(r, g, b, a);
        } else if (type === DMXAttributeType.Vector2) {
            const x = readFloat32();
            const y = readFloat32();
            return vec2.fromValues(x, y);
        } else if (type === DMXAttributeType.Vector3) {
            const x = readFloat32();
            const y = readFloat32();
            const z = readFloat32();
            return vec3.fromValues(x, y, z);
        } else if (type === DMXAttributeType.Vector4) {
            const x = readFloat32();
            const y = readFloat32();
            const z = readFloat32();
            const w = readFloat32();
            return vec4.fromValues(x, y, z, w);
        } else if (type === DMXAttributeType.QAngle) {
            const pitch = readFloat32();
            const yaw = readFloat32();
            const roll = readFloat32();
            return vec3.fromValues(pitch, yaw, roll);
        } else if (type === DMXAttributeType.Quaternion) {
            const x = readFloat32();
            const y = readFloat32();
            const z = readFloat32();
            const w = readFloat32();
            return quat.fromValues(x, y, z, w);
        } else if (type === DMXAttributeType.VMatrix) {
            const m00 = readFloat32();
            const m01 = readFloat32();
            const m02 = readFloat32();
            const m03 = readFloat32();
            const m10 = readFloat32();
            const m11 = readFloat32();
            const m12 = readFloat32();
            const m13 = readFloat32();
            const m20 = readFloat32();
            const m21 = readFloat32();
            const m22 = readFloat32();
            const m23 = readFloat32();
            const m30 = readFloat32();
            const m31 = readFloat32();
            const m32 = readFloat32();
            const m33 = readFloat32();
            return mat4.fromValues(
                m00, m10, m20, m30,
                m01, m11, m21, m31,
                m02, m12, m22, m32,
                m03, m13, m23, m33,
            );
        } else {
            throw "whoops";
        }
    }

    if (version >= 2) {
        const stringCount = (version >= 4) ? readUint32() : readUint16();
        for (let i = 0; i < stringCount; i++)
            stringTable.push(readStr(false));
    }

    const elemCount = readUint32();
    for (let i = 0; i < elemCount; i++) {
        const type = readStr(version >= 2);
        const name = readStr(version >= 4);
        const guid = readString(buffer, offs + 0x08, 0x10, false);
        offs += 0x10;
        const attributes: DMXAttribute[] = [];
        elements.push({ type, name, attributes });
    }

    for (let i = 0; i < elemCount; i++) {
        const element = elements[i];
        const attribCount = readUint32();
        for (let j = 0; j < attribCount; j++) {
            const name = readStr(version >= 2);
            const type = view.getUint8(offs++);

            let value = parseAttribute(type);
            element.attributes.push({ name, type, value });
        }
    }

    const rootElement = elements[0];
    return { magic, subversion, rootElement };
}
