import { quat, vec3 } from "gl-matrix";
import { getPointHermite } from "../Spline";
import { lerp } from "../MathHelpers";
import { align, assert } from "../util";
import { Endianness } from "../endian";
import ArrayBufferSlice from "../ArrayBufferSlice";

const enum CurveKind {
    Spline,
    Linear,
    Sparse,

    // unused?
    Binary,
    Steps,

    // not in the game, just a simplification
    Constant,
}

interface SplineCurve {
    kind: CurveKind.Spline;

    boundaries: Uint8Array | Uint16Array;
    values: Int16Array;
    tangents: Int16Array;
}

interface LinearCurve {
    kind: CurveKind.Linear;

    values: Int16Array;
}

interface SparseCurve {
    kind: CurveKind.Sparse;

    changes: Uint8Array;
    values: Int16Array;
}

interface ConstantCurve {
    kind: CurveKind.Constant;
    value: number;
}

type CurveData = SplineCurve | LinearCurve | SparseCurve | ConstantCurve;

interface Curve {
    part: number;
    isPosition: boolean;
    component: number;
    scale: number;
    data: CurveData;
}

export interface ObjectAnimationList {
    animations: ObjectAnimation[];
    bindPose: PartTransform[];
}

interface PartTransform {
    parent: number;
    pos: vec3;
    rot: quat;
}

interface ObjectAnimation {
    fps: number;
    segmentCount: number;
    frameInterval: number;
    isRelative: boolean;
    curves: Curve[];
}

function countSparseCurveChanges(bits: Uint8Array, max: number): number {
    let count = 0;
    for (let i = 1; i < max; i++)
        if (bits[i >>> 3] & (1 << (i & 7)))
            count++;
    return count;
}

const animationBlockStart = 0x40CC00;
export function parseAnimationList(data: ArrayBufferSlice, id: number): ObjectAnimationList {
    const view = data.createDataView();

    const objectListOffs = 0x482FC0 - animationBlockStart;

    const animations: ObjectAnimation[] = [];
    const bindPose: PartTransform[] = [];

    const tableCount = view.getUint16(objectListOffs, true);
    for (let i = 0; i < tableCount; i++) {
        let tableOffs = objectListOffs + view.getUint32(objectListOffs + 4 * i + 4, true);
        if (view.getUint16(tableOffs + 0x02, true) !== id)
            continue;
        const animCount = view.getUint16(tableOffs + 0x00, true);
        tableOffs += 4;
        for (let j = 0; j < animCount; j++) {
            const speed = view.getUint16(tableOffs + 0x00, true) / 256;
            const curveIndex = view.getUint16(tableOffs + 0x02, true);
            tableOffs += 4;

            const fps = speed * 30;

            animations.push(parseAnimation(data, fps, curveIndex));
        }

        let bindPoseOffset = view.getUint32(4 * i + 4, true);
        const partCount = view.getUint16(bindPoseOffset + 0x0A, true);
        bindPoseOffset += 0x10;
        for (let j = 0; j < partCount; j++) {
            const partIndex = view.getUint8(bindPoseOffset + 0x0C);
            const parent = view.getUint8(bindPoseOffset + 0x0D) - 1;
            assert(partIndex === j && parent < j);
            const pos = vec3.fromValues(
                view.getFloat32(bindPoseOffset + 0x00, true),
                view.getFloat32(bindPoseOffset + 0x04, true),
                view.getFloat32(bindPoseOffset + 0x08, true),
            );
            const rot = quat.fromValues(
                view.getFloat32(bindPoseOffset + 0x10, true),
                view.getFloat32(bindPoseOffset + 0x14, true),
                view.getFloat32(bindPoseOffset + 0x18, true),
                -view.getFloat32(bindPoseOffset + 0x1C, true),
            );
            bindPoseOffset += 0x20;

            bindPose.push({ parent, pos, rot });
        }
    }
    return { animations, bindPose };
}

function parseAnimation(data: ArrayBufferSlice, fps: number, curveIndex: number): ObjectAnimation {
    const view = data.createDataView();

    const curveTableOffs = 0x41B740 - animationBlockStart;

    const curveStart = curveTableOffs + view.getUint32(curveTableOffs + 4 + 4 * curveIndex, true);
    const segmentCount = view.getUint16(curveStart + 0x00, true);
    const curveCount = view.getUint16(curveStart + 0x02, true);
    const frameInterval = view.getUint16(curveStart + 0x04, true) / 0xA0; // everything is done in terms of these 0xA0-"frame" steps
    const isRelative = view.getInt8(curveStart + 0x07) !== 0;

    const curves: Curve[] = [];
    let curveOffs = curveStart + 0x08;
    let dataOffs = curveStart + view.getUint16(curveOffs, true);
    for (let i = 0; i < curveCount; i++) {
        curveOffs += 2;
        const toNext = (i < curveCount - 1) ? view.getUint16(curveOffs, true) : -1;
        curves.push(parseCurve(data, dataOffs, segmentCount, toNext));
        dataOffs += toNext;
    }

    return { fps, frameInterval, segmentCount, isRelative, curves };
}

const enum CurveFlag {
    COMPONENT_MASK  = 0x03,
    ROTATION        = 0x08,
    POSITION        = 0x0C,
    LINEAR          = 0x10,
    STEPS           = 0x20,
    SPARSE          = 0x40,
    BINARY          = 0x80,
}

function parseCurve(buffer: ArrayBufferSlice, offset: number, segmentCount: number, expectedLength: number): Curve {
    const view = buffer.createDataView();

    const part = view.getUint8(offset + 0x00);
    const flags = view.getUint8(offset + 0x01);
    const variableBits = flags & CurveFlag.POSITION;
    assert(variableBits === CurveFlag.POSITION || variableBits === CurveFlag.ROTATION);
    const isPosition = variableBits === CurveFlag.POSITION;
    const component = flags & CurveFlag.COMPONENT_MASK;
    const scale = isPosition ? view.getFloat32(offset + 4, true) : 1 / (1 << 15);

    if (isPosition)
        assert(component !== 3); // ignore w component of position

    assert((flags & CurveFlag.BINARY) === 0 && (flags & CurveFlag.STEPS) === 0);
    let dataStart = offset + 0x04;
    let dataEnd = offset + 0x08;
    if (isPosition)
        dataStart = offset + 0x08;
    else if (flags & CurveFlag.LINEAR)
        dataStart = offset + 0x02;

    let data: CurveData;
    if (flags & CurveFlag.SPARSE) {
        const shortsNeeded = (segmentCount + 0xF) >>> 4;
        const changes = buffer.createTypedArray(Uint8Array, dataStart, 2 * shortsNeeded);
        assert((changes[0] & 1) !== 0);
        const valueCount = countSparseCurveChanges(changes, segmentCount) + 1;
        if (valueCount > 1)
            data = {
                kind: CurveKind.Sparse,
                changes,
                values: buffer.createTypedArray(Int16Array, dataStart + 2 * shortsNeeded, valueCount, Endianness.LITTLE_ENDIAN),
            };
        else
            data = {
                kind: CurveKind.Constant,
                value: view.getInt16(dataStart + 2 * shortsNeeded, true),
            };
        dataEnd = Math.max(dataEnd, dataStart + 2 * shortsNeeded + 2 * valueCount);
    } else if (flags & CurveFlag.LINEAR) {
        data = {
            kind: CurveKind.Linear,
            values: buffer.createTypedArray(Int16Array, dataStart, segmentCount, Endianness.LITTLE_ENDIAN),
        };
        dataEnd = dataStart + 2 * segmentCount;
    } else {
        const splineCount = view.getUint16(offset + 2, true);
        let pointStart = 0;
        let boundaries;
        if (segmentCount < 0x100) {
            pointStart = dataStart + align(splineCount, 2);
            boundaries = buffer.createTypedArray(Uint8Array, dataStart, splineCount);
        } else {
            pointStart = dataStart + 2 * splineCount;
            boundaries = buffer.createTypedArray(Uint16Array, dataStart, splineCount, Endianness.LITTLE_ENDIAN);
        }

        data = {
            kind: CurveKind.Spline,
            boundaries,
            values: buffer.createTypedArray(Int16Array, pointStart, splineCount, Endianness.LITTLE_ENDIAN),
            tangents: buffer.createTypedArray(Int16Array, pointStart + 2 * splineCount, splineCount, Endianness.LITTLE_ENDIAN),
        };
        dataEnd = pointStart + 4 * splineCount;
    }

    // there are some extra bytes that couldn't be explained by alignment
    assert(Math.abs(offset + expectedLength - dataEnd) <= 2 || expectedLength < 0);

    return { part, isPosition, component, data, scale };
}

export function applyCurve(animation: ObjectAnimation, curve: Curve, frame: number, pos: vec3, rot: quat): void {
    let value = 0;
    const currSeg = ((frame / animation.frameInterval) >>> 0) + 1;
    switch (curve.data.kind) {
        case CurveKind.Spline: {
            let i = 0;
            for (; i < curve.data.boundaries.length; i++)
                if (curve.data.boundaries[i] >= currSeg)
                    break;
            const segDelta = (curve.data.boundaries[i] - curve.data.boundaries[i - 1]);
            let tangentFactor = segDelta / animation.frameInterval;
            if (!curve.isPosition)
                tangentFactor *= 2;
            value = getPointHermite(
                curve.data.values[i - 1], curve.data.values[i],
                tangentFactor * curve.data.tangents[i - 1], tangentFactor * curve.data.tangents[i],
                (frame - curve.data.boundaries[i - 1]) / segDelta,
            );
        } break;
        case CurveKind.Linear: {
            value = lerp(
                curve.data.values[currSeg - 1],
                curve.data.values[currSeg],
                (frame % animation.frameInterval) / animation.frameInterval,
            );
        } break;
        case CurveKind.Sparse: {
            const index = countSparseCurveChanges(curve.data.changes, currSeg);
            const duringChange = (curve.data.changes[currSeg >>> 3] & (1 << (currSeg & 7)));
            if (duringChange)
                value = lerp(
                    curve.data.values[index],
                    curve.data.values[index + 1],
                    (frame % animation.frameInterval) / animation.frameInterval,
                );
            else
                value = curve.data.values[index];
        } break;
        case CurveKind.Constant:
            value = curve.data.value; break;
    }

    if (isNaN(value))
        debugger
    value *= curve.scale;
    // flip quaternion w
    if (!curve.isPosition && curve.component === 3)
        value = -value;
    if (curve.isPosition)
        pos[curve.component] = value;
    else
        rot[curve.component] = value;
}