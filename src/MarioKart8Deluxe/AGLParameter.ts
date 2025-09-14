
// AGL Parameter Archives (sometimes known as "AAMP")
// https://zeldamods.org/wiki/AAMP

import { ReadonlyVec2, ReadonlyVec3, ReadonlyVec4, vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA } from "../Color.js";
import { assert, nullify, readString } from "../util.js";
import * as CRC32 from 'crc-32';

// https://github.com/open-ead/sead/blob/master/include/hostio/seadHostIOCurve.h
// https://github.com/open-ead/agl/blob/master/include/agl/Utils/aglParameterCurve.hpp

export enum CurveType {
    Linear,
    Hermite,
    Step,
    Sin,
    Cos,
    SinPow2,
    Linear2D,
    Hermite2D,
    Step2D,
    NonUniformSpline,
    Hermite2DSmooth,
}

export class Curve {
    public numUse: number;
    public type: CurveType;
    public coef: number[] = [];
}

enum ParameterType {
    Bool = 0,
    F32,
    Int,
    Vec2,
    Vec3,
    Vec4,
    Color,
    String32,
    String64,
    Curve1,
    Curve2,
    Curve3,
    Curve4,
    BufferInt,
    BufferF32,
    String256,
    Quat,
    U32,
    BufferU32,
    BufferBinary,
    StringRef,
    Other,
}

interface ParameterBase {
    nameHash: number;
    type: ParameterType;
}

export interface ParameterBool extends ParameterBase {
    type: ParameterType.Bool;
    value: boolean;
}

export interface ParameterNumber extends ParameterBase {
    type: ParameterType.F32 | ParameterType.Int | ParameterType.U32;
    value: number;
}

export interface ParameterVec2 extends ParameterBase {
    type: ParameterType.Vec2;
    value: ReadonlyVec2;
}

export interface ParameterVec3 extends ParameterBase {
    type: ParameterType.Vec3;
    value: ReadonlyVec3;
}

export interface ParameterVec4 extends ParameterBase {
    type: ParameterType.Vec4;
    value: ReadonlyVec4;
}

export interface ParameterColor extends ParameterBase {
    type: ParameterType.Color;
    value: Color;
}

export interface ParameterString extends ParameterBase {
    type: ParameterType.String32 | ParameterType.String64 | ParameterType.String256 | ParameterType.StringRef;
    value: string;
}

interface ParameterCurve1 extends ParameterBase {
    type: ParameterType.Curve1;
    value: [Curve];
}

interface ParameterCurve2 extends ParameterBase {
    type: ParameterType.Curve2;
    value: [Curve, Curve];
}

interface ParameterCurve3 extends ParameterBase {
    type: ParameterType.Curve3;
    value: [Curve, Curve, Curve];
}

interface ParameterCurve4 extends ParameterBase {
    type: ParameterType.Curve4;
    value: [Curve, Curve, Curve, Curve];
}

type Parameter = ParameterBool | ParameterNumber | ParameterVec2 | ParameterVec3 | ParameterVec4 | ParameterColor | ParameterString | ParameterCurve1 | ParameterCurve2 | ParameterCurve3 | ParameterCurve4;

export interface ParameterObject {
    nameHash: number;
    parameters: Parameter[];
}

export interface ParameterList {
    nameHash: number;
    objects: ParameterObject[];
    lists: ParameterList[];
}

export interface ParameterArchive {
    root: ParameterList;
    type: string;
}

export function parse(buffer: ArrayBufferSlice): ParameterArchive {
    const view = buffer.createDataView();
    const littleEndian = true;

    assert(readString(buffer, 0x00, 0x04) === 'AAMP');

    const flags = view.getUint32(0x08);
    const version = view.getUint32(0x04, littleEndian);
    assert(version === 0x02);

    const rootOffs = 0x30 + view.getUint32(0x14, littleEndian);
    const listCount = view.getUint32(0x18, littleEndian);
    const objectCount = view.getUint32(0x1C, littleEndian);
    const parameterCount = view.getUint32(0x20, littleEndian);
    const type = readString(buffer, 0x30);

    function parseParameter(offs: number): Parameter {
        const nameHash = view.getUint32(offs + 0x00, littleEndian);
        const b24 = view.getUint32(offs + 0x04, littleEndian);

        const type: ParameterType = (b24 >>> 24) & 0xFF;
        const dataOffset = offs + (b24 & 0x00FFFFFF) * 4;

        if (type === ParameterType.Bool) {
            const value = !!view.getUint32(dataOffset + 0x00, littleEndian);
            return { nameHash, type, value };
        } else if (type === ParameterType.F32) {
            const value = view.getFloat32(dataOffset + 0x00, littleEndian);
            return { nameHash, type, value };
        } else if (type === ParameterType.Int) {
            const value = view.getInt32(dataOffset + 0x00, littleEndian);
            return { nameHash, type, value };
        } else if (type === ParameterType.Vec2) {
            const x = view.getFloat32(dataOffset + 0x00, littleEndian);
            const y = view.getFloat32(dataOffset + 0x04, littleEndian);
            const value = vec2.fromValues(x, y);
            return { nameHash, type, value };
        } else if (type === ParameterType.Vec3) {
            const x = view.getFloat32(dataOffset + 0x00, littleEndian);
            const y = view.getFloat32(dataOffset + 0x04, littleEndian);
            const z = view.getFloat32(dataOffset + 0x08, littleEndian);
            const value = vec3.fromValues(x, y, z);
            return { nameHash, type, value };
        } else if (type === ParameterType.Vec4) {
            const x = view.getFloat32(dataOffset + 0x00, littleEndian);
            const y = view.getFloat32(dataOffset + 0x04, littleEndian);
            const z = view.getFloat32(dataOffset + 0x08, littleEndian);
            const w = view.getFloat32(dataOffset + 0x0C, littleEndian);
            const value = vec4.fromValues(x, y, z, w);
            return { nameHash, type, value };
        } else if (type === ParameterType.Color) {
            const r = view.getFloat32(dataOffset + 0x00, littleEndian);
            const g = view.getFloat32(dataOffset + 0x04, littleEndian);
            const b = view.getFloat32(dataOffset + 0x08, littleEndian);
            const a = view.getFloat32(dataOffset + 0x0C, littleEndian);
            const value = colorNewFromRGBA(r, g, b, a);
            return { nameHash, type, value };
        } else if (type === ParameterType.String32) {
            const value = readString(buffer, dataOffset + 0x00, 32);
            return { nameHash, type, value };
        } else if (type === ParameterType.String64) {
            const value = readString(buffer, dataOffset + 0x00, 64);
            return { nameHash, type, value };
        } else if (type === ParameterType.Curve1) {
            const value: Curve[] = [];
            let curveIdx = dataOffset;
            for (let i = 0; i < 1; i++, curveIdx += 0x80) {
                const curve = new Curve();
                curve.numUse = view.getUint32(curveIdx + 0x00, littleEndian);
                curve.type = view.getUint32(curveIdx + 0x04, littleEndian);
                for (let j = 0; j < 30; j++)
                    curve.coef[j] = view.getFloat32(curveIdx + 0x08 + 0x04 * j, littleEndian);
            }
            return { nameHash, type, value: value as [Curve] };
        } else if (type === ParameterType.String256) {
            const value = readString(buffer, dataOffset + 0x00, 256);
            return { nameHash, type, value };
        } else if (type === ParameterType.StringRef) {
            const value = readString(buffer, dataOffset + 0x00);
            return { nameHash, type, value };
        } else if (type === ParameterType.U32) {
            const value = view.getUint32(dataOffset + 0x00, littleEndian);
            return { nameHash, type, value };
        } else {
            throw "whoops";
        }
    }

    function parseObject(offs: number): ParameterObject {
        const nameHash = view.getUint32(offs + 0x00, littleEndian);

        const parameters: Parameter[] = [];
        let parameterIdx = offs + view.getUint16(offs + 0x04, littleEndian) * 4;
        const parameterCount = view.getUint16(offs + 0x06, littleEndian);
        for (let i = 0; i < parameterCount; i++, parameterIdx += 0x08)
            parameters.push(parseParameter(parameterIdx));

        return { nameHash, parameters };
    }

    function parseList(offs: number): ParameterList {
        const nameHash = view.getUint32(offs + 0x00, littleEndian);

        const objects: ParameterObject[] = [];

        let objectIdx = offs + view.getUint16(offs + 0x08, littleEndian) * 4;
        const objectCount = view.getUint16(offs + 0x0A, littleEndian);
        for (let i = 0; i < objectCount; i++, objectIdx += 0x08)
            objects.push(parseObject(objectIdx));

        const lists: ParameterList[] = [];

        let listIdx = offs + view.getUint16(offs + 0x04, littleEndian) * 4;
        const listCount = view.getUint16(offs + 0x06, littleEndian);
        for (let i = 0; i < listCount; i++, listIdx += 0x0C)
            lists.push(parseList(listIdx));

        return { nameHash, objects, lists };
    }

    const root = parseList(rootOffs);

    return { root, type };
}

export function hashCode(v: string): number {
    return CRC32.str(v) >>> 0;
}

export function findWithName<T extends { nameHash: number }>(L: T[], name: string): T | null {
    const nameHash = hashCode(name);
    return nullify(L.find((o) => o.nameHash === nameHash));
}
