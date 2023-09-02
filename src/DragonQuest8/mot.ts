import { mat4, quat, vec3, vec4 } from "gl-matrix";
import AnimationController from "../AnimationController.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { lerp } from "../MathHelpers.js";
import { align, assert, assertExists, readString } from "../util.js";
import * as MDS from "./mds.js";

const scratchQuatAQ: quat = quat.create();
const scratchVec3AT: vec3 = vec3.create();
const scratchVec3AS: vec3 = vec3.create();

function vec4FromView(view: DataView, offset: number, littleEndian: boolean): vec4 {
    return vec4.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
        view.getFloat32(offset + 0xC, littleEndian),
    );
}

interface KeyframedVec4Value {
    timing: number;
    value: vec4;
}

interface KeyframedBooleanValue {
    timing: number;
    value: boolean;
}

export interface MotionInfo {
    name: string;
    frameStart: number;
    frameEnd: number;
    speedFactor: number;
}

interface KeyframedJoint {
    scaleKfs: KeyframedVec4Value[];
    posKfs: KeyframedVec4Value[];
    rotKfs: KeyframedVec4Value[];
    jointVisKfs: KeyframedBooleanValue[];
}

export enum ESemantic {
    ROTATION = 0x1,
    TRANSLATION = 0x3,
    SCALE = 0x4,
    SUBMESHVISIBILITY = 0x5,
    JOINTVISIBILITY = 0x7
}

export enum EDatatype {
    //Bit count most likely, only these two seen so far
    SHORT = 0x10,
    FLOAT = 0x20
}

export class Motion {
    public name: string;
    public jointIDToKeyframedJoint = new Map<number, KeyframedJoint>();
    public frameCount: number;
    public speedFactor: number;
}

export class MOT {
    public name: string;
    public motionNameToMotion = new Map<string, Motion>();
}

function getAnimFrame(motion: Motion, frame: number) {
    if (motion.frameCount === 0) //see Cottage
        return 0;
    while (frame > motion.frameCount)
        frame -= motion.frameCount;
    return frame;
}

function sampleAnimTrack(kfs: KeyframedVec4Value[], frame: number, v: vec3): vec3 {

    const idx1 = kfs.findIndex((key) => (frame < key.timing));
    if (idx1 === 0) {
        vec3.set(v, kfs[0].value[0], kfs[0].value[1], kfs[0].value[2]);
        return v;
    }
    if (idx1 < 0) {
        vec3.set(v, kfs[kfs.length - 1].value[0], kfs[kfs.length - 1].value[1], kfs[kfs.length - 1].value[2]);
        return v;
    }
    const idx0 = idx1 - 1;

    const k0 = kfs[idx0];
    const k1 = kfs[idx1];

    const t = (frame - k0.timing) / (k1.timing - k0.timing);
    const x = lerp(k0.value[0], k1.value[0], t);
    const y = lerp(k0.value[1], k1.value[1], t);
    const z = lerp(k0.value[2], k1.value[2], t);
    vec3.set(v, x, y, z);
    return v;
}

function sampleAnimTrackRotation(kfs: KeyframedVec4Value[], frame: number, q: quat): quat {
    const idx1 = kfs.findIndex((key) => (frame < key.timing));
    if (idx1 === 0) {
        quat.set(q, kfs[0].value[0], kfs[0].value[1], kfs[0].value[2], kfs[0].value[3]);
        return q;
    }

    if (idx1 < 0) {
        quat.set(q, kfs[kfs.length - 1].value[0], kfs[kfs.length - 1].value[1], kfs[kfs.length - 1].value[2], kfs[kfs.length - 1].value[3]);
        return q;
    }
    const idx0 = idx1 - 1;

    const k0 = kfs[idx0];
    const k1 = kfs[idx1];

    const t = (frame - k0.timing) / (k1.timing - k0.timing);
    quat.slerp(q, k0.value, k1.value, t);
    return q;
}

export function computeMatricesAndVisibility(dst: mat4, animationController: AnimationController | null, motion: Motion | null, joint: MDS.Joint, jointVisMap: Map<number, boolean> | null = null): void {

    if (motion === null || !motion?.jointIDToKeyframedJoint.has(joint.id) || animationController === null) {
        mat4.copy(dst, joint.transform);
        if (jointVisMap !== null && jointVisMap.has(joint.id)) {
            jointVisMap.set(joint.id, joint.bIsDefaultVisible);
        }
        return;
    }

    const frame = assertExists(animationController).getTimeInFrames() * motion.speedFactor;
    const animFrame = getAnimFrame(motion!, frame);
    let rotation = joint.rotation;
    let translation = joint.translation;
    let scale = joint.scale;

    if (motion.jointIDToKeyframedJoint.get(joint.id)?.scaleKfs.length)
        scale = sampleAnimTrack(motion.jointIDToKeyframedJoint.get(joint.id)?.scaleKfs as KeyframedVec4Value[], animFrame, scratchVec3AS);
    if (motion.jointIDToKeyframedJoint.get(joint.id)?.posKfs.length)
        translation = sampleAnimTrack(motion.jointIDToKeyframedJoint.get(joint.id)?.posKfs as KeyframedVec4Value[], animFrame, scratchVec3AT);
    if (motion.jointIDToKeyframedJoint.get(joint.id)?.rotKfs.length) {
        rotation = sampleAnimTrackRotation(motion.jointIDToKeyframedJoint.get(joint.id)?.rotKfs as KeyframedVec4Value[], animFrame, scratchQuatAQ);
        rotation = quat.conjugate(rotation, rotation);
    }
    mat4.fromRotationTranslationScale(dst, rotation, translation, scale);

    if (jointVisMap !== null && jointVisMap.has(joint.id)) {
        if (motion.jointIDToKeyframedJoint.has(joint.id) && motion.jointIDToKeyframedJoint.get(joint.id)!.jointVisKfs.length) {
            const bIsVisible = motion.jointIDToKeyframedJoint.get(joint.id)!.jointVisKfs[Math.floor(animFrame)].value;
            jointVisMap.set(joint.id, bIsVisible);
        }
        else {
            jointVisMap.set(joint.id, joint.bIsDefaultVisible);
        }
    }
}

function processTrack(version: number, buffer: ArrayBufferSlice, entryCount: number, frameToKFV: Map<number, KeyframedVec4Value>) {
    const view = buffer.createDataView();
    let offs = 0;
    const dataType: EDatatype = version ? view.getUint8(offs + 0x1) : view.getUint32(offs + 0x8, true);
    const timingDataType: EDatatype = version ? view.getUint8(offs + 0x2) : view.getUint32(offs + 0xC, true); //Assumption, never seen other type than SHORT
    const kfCount: number = version ? view.getUint16(offs + 0x6, true) : view.getUint32(offs + 0x18, true);
    const kfTimingStart: number = version ? view.getUint32(offs + 0x8, true) : view.getUint32(offs + 0x1C, true);
    const kfDataStart: number = version ? view.getUint32(offs + 0xC, true) : view.getUint32(offs + 0x20, true);
    const quantScale: vec4 = version ? vec4FromView(view, offs + 0x10, true) : vec4FromView(view, align(offs + 0x24, 0x10), true);
    const kfTimings = [];
    const kfValues = [];
    offs = kfTimingStart;
    if (kfTimingStart) {
        for (let i = 0; i < kfCount; i++) {
            kfTimings.push(view.getUint16(offs + 2 * i, true));
        }
    }
    else {
        for (let i = 0; i < kfCount; i++)
            kfTimings.push(i);
    }
    offs = kfDataStart;
    for (let i = 0; i < kfCount; i++) {
        if (dataType === EDatatype.SHORT) {
            kfValues.push(vec4.fromValues(view.getInt16(offs, true), view.getInt16(offs + 0x2, true), view.getInt16(offs + 0x4, true), entryCount === 3 ? 0 : view.getInt16(offs + 0x6, true)));
            for (let j = 0; j < 4; j++)
                kfValues[i][j] *= quantScale[j] / 32768;
            frameToKFV.set(kfTimings[i], { timing: kfTimings[i], value: kfValues[i] });
            offs += entryCount === 3 ? 6 : 8;
        }
        else if (dataType === EDatatype.FLOAT) {
            kfValues.push(vec4.fromValues(view.getFloat32(offs, true), view.getFloat32(offs + 0x4, true), view.getFloat32(offs + 0x8, true), entryCount === 3 ? 0 : view.getFloat32(offs + 0xC, true)));
            for (let j = 0; j < 4; j++)
                kfValues[i][j] *= quantScale[j];
            frameToKFV.set(kfTimings[i], { timing: kfTimings[i], value: kfValues[i] });
            offs += entryCount === 3 ? 12 : 16;
        }
    }
}

function processJointVisTrack(version: number, buffer: ArrayBufferSlice, jointVisKfValues: KeyframedBooleanValue[]) {
    const view = buffer.createDataView();
    let offs = 0;
    const dataType: EDatatype = version ? view.getUint8(offs + 0x1) : view.getUint32(offs + 0x8, true);
    const timingDataType: EDatatype = version ? view.getUint8(offs + 0x2) : view.getUint32(offs + 0xC, true); //Assumption, never seen other type than SHORT
    const kfCount: number = version ? view.getUint16(offs + 0x6, true) : view.getUint32(offs + 0x18, true);
    const kfTimingStart: number = version ? view.getUint32(offs + 0x8, true) : view.getUint32(offs + 0x1C, true);
    const kfDataStart: number = version ? view.getUint32(offs + 0xC, true) : view.getUint32(offs + 0x20, true);
    const kfTimings = [];
    const kfValues = [];
    offs = kfTimingStart;
    if (kfTimingStart) {
        for (let i = 0; i < kfCount; i++) {
            kfTimings.push(view.getUint16(offs + 2 * i, true));
        }
    }
    else {
        for (let i = 0; i < kfCount; i++)
            kfTimings.push(i);
    }
    offs = kfDataStart;
    for (let i = 0; i < kfCount; i++) {
        kfValues.push(view.getUint8(offs) ? true : false);
        jointVisKfValues.push({ timing: kfTimings[i], value: kfValues[i] });
        offs += 1;
    }
}

export function parse(buffer: ArrayBufferSlice, name: string, motionInfo: MotionInfo[]): MOT {
    const view = buffer.createDataView();
    const mot = new MOT();
    mot.name = name.split('/').pop()!;

    const magic = readString(buffer, 0x01, 0x03);
    assert(magic === 'MOT');
    const version = view.getUint32(0x04, true);
    const headerSize = view.getUint32(0x08, true);
    const jointTrackCount = view.getUint32(0x1C, true);
    const jointTrackOffset = view.getUint32(0x20, true);

    let offs = jointTrackOffset;
    const jointIDToRotFrameMap = new Map<number, Map<number, KeyframedVec4Value>>();
    const jointIDToPosFrameMap = new Map<number, Map<number, KeyframedVec4Value>>();
    const jointIDToScaleFrameMap = new Map<number, Map<number, KeyframedVec4Value>>();
    const jointIDToJointVisValues = new Map<number, KeyframedBooleanValue[]>();

    for (let i = 0; i < jointTrackCount; i++) {
        const offsetToNextTrack = view.getUint32(offs, true);
        const jointID = view.getUint32(offs + 0x4, true);
        //unk at 0x8
        let semanticCount = view.getUint32(offs + 0xC, true) - 1;
        if (!semanticCount)
            semanticCount += 1;

        jointIDToRotFrameMap.set(jointID, new Map<number, KeyframedVec4Value>());
        jointIDToPosFrameMap.set(jointID, new Map<number, KeyframedVec4Value>());
        jointIDToScaleFrameMap.set(jointID, new Map<number, KeyframedVec4Value>());

        let offs2 = 0x10;
        for (let j = 0; j < semanticCount; j++) {

            const semanticType: ESemantic = view.getUint32(offs + offs2, true);
            const dataOffset: number = view.getUint32(offs + offs2 + 0x4, true);
            offs2 += 0x8;

            if (semanticType === ESemantic.ROTATION)
                processTrack(version, buffer.slice(offs + dataOffset), 4, jointIDToRotFrameMap.get(jointID) as Map<number, KeyframedVec4Value>);
            else if (semanticType === ESemantic.TRANSLATION)
                processTrack(version, buffer.slice(offs + dataOffset), 3, jointIDToPosFrameMap.get(jointID) as Map<number, KeyframedVec4Value>);
            else if (semanticType === ESemantic.SCALE)
                processTrack(version, buffer.slice(offs + dataOffset), 3, jointIDToScaleFrameMap.get(jointID) as Map<number, KeyframedVec4Value>);
            else if (semanticType === ESemantic.JOINTVISIBILITY) {
                jointIDToJointVisValues.set(jointID, []);
                processJointVisTrack(version, buffer.slice(offs + dataOffset), jointIDToJointVisValues.get(jointID) as KeyframedBooleanValue[]);
            }

        }

        offs += offsetToNextTrack;
    }

    for (let i = 0; i < motionInfo.length; i++) {
        const motion = new Motion();
        motion.name = motionInfo[i].name;
        motion.frameCount = motionInfo[i].frameEnd - motionInfo[i].frameStart;
        motion.speedFactor = motionInfo[i].speedFactor;
        for (const jointID of jointIDToRotFrameMap.keys()) {
            const rotKfValues: KeyframedVec4Value[] = [];
            const posKfValues: KeyframedVec4Value[] = [];
            const scaleKfValues: KeyframedVec4Value[] = [];
            const jointVisKfValues: KeyframedBooleanValue[] = [];

            for (let kfTiming = motionInfo[i].frameStart; kfTiming <= motionInfo[i].frameEnd; kfTiming++) {
                if (jointIDToRotFrameMap.get(jointID)!.has(kfTiming))
                    rotKfValues.push({ timing: kfTiming - motionInfo[i].frameStart, value: jointIDToRotFrameMap.get(jointID)!.get(kfTiming)!.value });
                if (jointIDToPosFrameMap.get(jointID)!.has(kfTiming))
                    posKfValues.push({ timing: kfTiming - motionInfo[i].frameStart, value: jointIDToPosFrameMap.get(jointID)!.get(kfTiming)!.value });
                if (jointIDToScaleFrameMap.get(jointID)!.has(kfTiming))
                    scaleKfValues.push({ timing: kfTiming - motionInfo[i].frameStart, value: jointIDToScaleFrameMap.get(jointID)!.get(kfTiming)!.value });
                if (jointIDToJointVisValues.has(jointID)) {
                    let idx1 = jointIDToJointVisValues.get(jointID)!.findIndex((key) => (kfTiming < key.timing));
                    if (idx1 === -1)
                        idx1 = jointIDToJointVisValues.get(jointID)!.length;
                    if (idx1 === 0) //Annoying edge case where the kf data doesn't have a 0 kf
                        continue;
                    jointVisKfValues.push({ timing: kfTiming - motionInfo[i].frameStart, value: jointIDToJointVisValues.get(jointID)![idx1 - 1].value });
                }

            }

            motion.jointIDToKeyframedJoint.set(jointID, { rotKfs: rotKfValues, posKfs: posKfValues, scaleKfs: scaleKfValues, jointVisKfs: jointVisKfValues });
        }

        mot.motionNameToMotion.set(motion.name, motion);
    }

    return mot;
}