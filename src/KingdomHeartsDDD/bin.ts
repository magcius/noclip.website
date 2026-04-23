import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DreamDropTextureFormat } from "./texture";

// Credit for CTRT/PMP/PMO parsing https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Ddd

/**
 * Raw model pack for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropPMP {
    pmos: DreamDropPMO[];
    ctrts: DreamDropCTRT[];
}

interface CTRTInfo {
    offset: number;
    name: string;
}

/**
 * Raw CTR texture for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropCTRT {
    name: string;
    width: number;
    height: number;
    format: DreamDropTextureFormat;
    data: ArrayBufferSlice;
}

interface PMOInfo {
    position: vec3;
    rotation: vec3;
    scale: vec3;
    offset: number;
    flags: number;
    id: number;
}

/**
 * Raw model for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropPMO {
    name: string;
    id: number;
    position: vec3;
    rotation: vec3;
    scale: vec3;
    scaleNum: number;
    flags: number;
    headerFlags: number;
    bbox: number[];
    materials: DreamDropPMOMaterial[];
    shapes: DreamDropPMOShape[];
    ctrts: DreamDropCTRT[];
    skeleton?: PMOSkeleton;
}

/**
 * Material for a PMO from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropPMOMaterial {
    textureOffset: number;
    textureName: string;
    scrollX: number;
    scrollY: number;
}

export interface DreamDropSet {
    name: string;
    olos: string[];
}

export interface DreamDropOLO {
    objects: DreamDropObjectInstance[];
}

export interface DreamDropObjectInstance {
    name: string;
    position: vec3;
    rotation: vec3;
}

export interface DreamDropPAM {
    animations: DreamDropAnimation[];
}

interface DreamDropAnimation {
    name: string;
    flag: number;
    framerate: number;
    interpolateFrameCount: number;
    loopFrame: number;
    boneCount: number;
    frameCount: number;
    returnFrame: number;
    boneSRT: AnimationBoneSRT[];
}

interface AnimationInfo {
    offset: number;
    name: string;
}

interface AnimationSRTFlags {
    translationX: boolean;
    translationY: boolean;
    translationZ: boolean;
    rotationX: boolean;
    rotationY: boolean;
    rotationZ: boolean;
    scaleX: boolean;
    scaleY: boolean;
    scaleZ: boolean;
}

interface AnimationBoneSRT {
    translationX?: AnimationData;
    translationY?: AnimationData;
    translationZ?: AnimationData;
    rotationX?: AnimationData;
    rotationY?: AnimationData;
    rotationZ?: AnimationData;
    scaleX?: AnimationData;
    scaleY?: AnimationData;
    scaleZ?: AnimationData;
}

interface AnimationData {
    minValue: number;
    maxValue: number;
    keyframes: AnimationKeyframe[]
}

interface AnimationKeyframe {
    frame: number;
    value: number;
}

interface PMOSkeleton {
    skinnedBoneCount: number;
    skinWeightCount: number;
    bones: PMOBone[];
}

interface PMOBone {
    index: number;
    parentIndex: number;
    skinnedIndex: number;
    jointName: string;
    transform: mat4;
    inverseTransform: mat4;
}

enum PMOPrimitiveFormat {
    POINT,
    LINE,
    LINE_STRIP,
    TRIANGLE_LIST,
    TRIANGLE_STRIP,
    TRIANGLE_FAN,
    QUAD
}

/**
 * Blend modes based on a shape's attribute 3rd nibble from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export enum DreamDropShapeAttributeBlend {
    TRANSLUCENT = 2,
    TRANSLUCENT2 = 3, // unsure what the difference is between 2 and 3, if any
    ADDITIVE = 4
}

/**
 * Values based on a model's flag 2nd nibble from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export enum DreamDropPMOFlags {
    BILLBOARD = 4
}

/**
 * Model shape (mesh) for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropPMOShape {
    public vertices: Float32Array;
    public colors: Float32Array;
    public uvs: Float32Array;
    public indices: Uint32Array;
    public weights?: vec4;
    public joints?: vec4;

    constructor(public vertexCount: number, public textureIndex: number, public vertexSizeBytes: number, public vertexFlags: number, public attribute: number, public boneIndices: number[]) {
        this.vertices = new Float32Array(vertexCount * 3);
        this.colors = new Float32Array(vertexCount * 4);
        this.uvs = new Float32Array(vertexCount * 2);

        const indices = [];
        const primitiveFormat = getBitsRange32(vertexFlags, 28, 4) as PMOPrimitiveFormat;
        switch (primitiveFormat) {
            case PMOPrimitiveFormat.TRIANGLE_STRIP:
                for (let i = 0; i < this.vertexCount - 2; i++) {
                    if (i % 2 === 0) {
                        indices.push(i);
                        indices.push(i + 1);
                        indices.push(i + 2);
                    } else {
                        indices.push(i + 1);
                        indices.push(i);
                        indices.push(i + 2);
                    }
                }
                break;
            case PMOPrimitiveFormat.TRIANGLE_LIST:
                for (let i = 0; i < this.vertexCount - 2; i += 3) {
                    indices.push(i);
                    indices.push(i + 1);
                    indices.push(i + 2);
                }
                break;
            default:
                console.warn("Unimplemented primitive format", primitiveFormat);
                break;
        }
        this.indices = new Uint32Array(indices);
    }
}

const MAGIC_PMP = 5262672;
const MAGIC_PMO = 5197136;
const MAGIC_CTRT = 1414681667;
const MAGIC_SETBIN = 4411969;
const MAGIC_OLO = 1330401088;
const MAGIC_PAM = 5062992;
const NORMALIZED_SCALE = 32768.0;
const COLOR_SCALE = 255.0 // standard but might as well
const UV_SCALE = 2048.0;
const JOINT_SCALE = 3.0;
const WEIGHT_SCALE = 128.0;

function getBits(n: number, pos: number, size: number) {
    return (n >> pos) & ((1 << size) - 1);
}

function getBit(n: number, pos: number) {
    return getBits(n, pos, 1) !== 0;
}

function getBitsRange32(value: number, start: number = 0, length: number = 1): number {
    let bit = value << 32 - (start + length);
    return bit >> 32 - length;
}

/**
 * Binary parser for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropParser {
    private view: DataView;
    private offset: number;
    private textDecoder: TextDecoder;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = this.buffer.createDataView();
        this.offset = 0;
        this.textDecoder = new TextDecoder("utf-8");
    }

    public parsePMP(name: string): DreamDropPMP {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_PMP) {
            console.warn("Unknown PMP magic", magic);
        }
        this.offset = 0x10;
        const pmoCount = this.getUshort();
        this.offset += 8;
        const ctrtCount = this.getUshort();
        const ctrtOffset = this.getUint32();

        this.offset = 0x20;
        const pmoInfo: PMOInfo[] = Array(pmoCount);
        for (let i = 0; i < pmoCount; i++) {
            const px = this.getFloat();
            const py = this.getFloat();
            const pz = this.getFloat();
            const rx = this.getFloat();
            const ry = this.getFloat();
            const rz = this.getFloat();
            const sx = this.getFloat();
            const sy = this.getFloat();
            const sz = this.getFloat();
            const pmoOffset = this.getUint32();
            this.offset += 4;
            const flags = this.getUshort();
            const id = this.getUshort();
            pmoInfo[i] = {
                position: vec3.fromValues(px, py, pz),
                rotation: vec3.fromValues(rx, ry, rz),
                scale: vec3.fromValues(sx, sy, sz),
                offset: pmoOffset, flags, id
            };
        }

        this.offset = ctrtOffset;
        const ctrts: (DreamDropCTRT | undefined)[] = Array(ctrtCount);
        if (ctrtOffset > 0) {
            const info: CTRTInfo[] = Array(ctrtCount);
            for (let i = 0; i < ctrtCount; i++) {
                const offset = this.getUint32();
                const name = this.getString(12);
                this.offset += 16;
                info[i] = { offset, name };
            }

            for (let i = 0; i < ctrtCount; i++) {
                ctrts[i] = this.parseCTRT(info[i].offset, info[i].name, false);
            }
        }

        const pmos: DreamDropPMO[] = Array(pmoCount);
        for (let i = 0; i < pmoCount; i++) {
            if (pmoInfo[i].offset === 0) {
                continue;
            }
            pmos[i] = this.parsePMO(pmoInfo[i]);
            pmos[i].name = `${name}_${i}_${pmos[i].id}`;
        }

        return { pmos: pmos.filter(p => p !== undefined), ctrts: ctrts.filter(t => t !== undefined) };
    }

    public parseCTRT(offset: number, name: string, allowZeroOffset: boolean = true): DreamDropCTRT | undefined {
        if ((!allowZeroOffset && offset > 0) || allowZeroOffset) {
            this.offset = offset;
            const magic = this.getUint32();
            if (magic !== MAGIC_CTRT) {
                console.warn("Unknown CTRT magic", magic);
            } else {
                this.offset = offset + 12;
                const dataOffset = this.getUint32();
                this.offset += 4;
                const dataSize = this.getUint32();
                this.offset += 4;
                const format = this.getUint32() as DreamDropTextureFormat;
                const width = this.getUshort();
                const height = this.getUshort();
                const data = this.buffer.slice(offset + dataOffset, offset + dataOffset + dataSize);
                return { name, width, height, format, data };
            }
        }
        return undefined;
    }

    public parseSetData(): DreamDropSet[] {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_SETBIN) {
            console.warn("Unknown set magic", magic);
        }
        this.offset = 6;
        const setCount = this.getUshort();
        this.offset = 0x10;

        const sets: DreamDropSet[] = Array(setCount);
        for (let i = 0; i < setCount; i++) {
            this.offset = 0x10 + (32 * i) + 4;
            const setOffset = this.getUint32();
            this.offset += 8;
            const name = this.getString(16);
            sets[i] = this.parseSet(setOffset, name);
        }

        return sets.filter(s => !s.name.includes("evt"));
    }

    public parseOLO(): DreamDropOLO {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_OLO) {
            console.warn("Unknown OLO magic", magic);
        }

        // this.offset = 8;
        // const objectCount = this.getUint32();
        // const objectOffset = this.getUint32();
        // this.offset = objectOffset;
        // const objectNames: string[] = Array(objectCount);
        // for (let i = 0; i < objectCount; i++) {
        //     objectNames[i] = this.getString(16);
        // }
        const objects: DreamDropObjectInstance[] = [];

        this.offset = 0x30;
        const groupCount = this.getUint32();
        const groupOffset = this.getUint32();
        for (let i = 0; i < groupCount; i++) {
            this.offset = groupOffset + (i * 0x30) + 40;
            // const cx = this.getFloat();
            // const cy = this.getFloat();
            // const cz = this.getFloat();
            // const radius = this.getFloat();
            // this.offset += 24;
            const layoutCount = this.getUint32();
            const layoutOffset = this.getUint32();
            for (let j = 0; j < layoutCount; j++) {
                const start = layoutOffset + (j * 80);
                this.offset = start;
                const nameOffset = this.getUint32();
                this.offset = nameOffset;
                const name = this.getString(16);
                this.offset = start + 4;
                const px = this.getFloat();
                const py = this.getFloat();
                const pz = this.getFloat();
                const rx = this.getFloat();
                const ry = this.getFloat();
                const rz = this.getFloat();
                objects.push({ name, position: vec3.fromValues(px, py, pz), rotation: vec3.fromValues(rx, ry, rz) });
            }
        }

        return { objects };
    }

    public parsePMO(info?: PMOInfo, parseCTRT: boolean = false, name: string = ""): DreamDropPMO {
        if (!info) {
            info = { offset: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], flags: -1, id: -1 };
        }
        this.offset = info.offset;
        const magic = this.getUint32();
        if (magic !== MAGIC_PMO) {
            console.warn("Unknown PMO magic", magic);
        }
        this.offset += 4;
        const materialCount = this.getByte();
        this.offset++;
        const flags = this.getUshort();
        const skeletonOffset = this.getUint32();
        const modelOffset = this.getUint32();
        const polyCount = this.getUshort();
        const vertexCount = this.getUshort();
        const scale = this.getFloat();
        this.offset += 4;
        const bbox: number[] = Array(32);
        for (let i = 0; i < bbox.length; i++) {
            bbox[i] = this.getFloat();
        }

        const materials: DreamDropPMOMaterial[] = Array(materialCount);
        for (let i = 0; i < materialCount; i++) {
            const textureOffset = this.getUint32();
            const textureName = this.getString(12);
            const scrollX = this.getFloat();
            const scrollY = this.getFloat();
            this.offset += 8;
            materials[i] = { textureOffset, textureName, scrollX, scrollY };
        }

        const ctrts: DreamDropCTRT[] = [];
        if (parseCTRT) {
            const ret = this.offset;
            for (const material of materials) {
                const o = info.offset + material.textureOffset;
                if (o === 0) {
                    continue;
                }
                const ctrt = this.parseCTRT(o, material.textureName);
                if (ctrt) {
                    ctrts.push(ctrt);
                }
            }
            this.offset = ret;
        }

        const opaqueShapeOffset = this.getUint32();
        const translucentShapeOffset = this.getUint32();
        const mainVertexCount = this.getUint32();
        const secondVertexCount = this.getUint32();
        const opaqueShapeCount = this.getUint32();
        const translucentShapeCount = this.getUint32();
        const vertexDataOffset = this.getUint32();
        const vertexDataSize = this.getUint32();

        this.offset += 8;

        // shape names are here, skipping

        if (opaqueShapeOffset !== 0) {
            this.offset = info.offset + opaqueShapeOffset;
        } else if (translucentShapeOffset !== 0) {
            this.offset = info.offset + translucentShapeOffset;
        }

        const opaqueShapes: DreamDropPMOShape[] = Array(opaqueShapeCount);
        for (let i = 0; i < opaqueShapeCount; i++) {
            opaqueShapes[i] = this.parsePMOShape();
        }
        if (opaqueShapeCount > 0) {
            this.offset += 24;
        }

        const translucentShapes: DreamDropPMOShape[] = Array(translucentShapeCount);
        for (let i = 0; i < translucentShapeCount; i++) {
            translucentShapes[i] = this.parsePMOShape();
        }
        if (translucentShapeCount > 0) {
            this.offset += 24;
        }

        this.offset = info.offset + vertexDataOffset;
        for (let i = 0; i < opaqueShapeCount; i++) {
            this.parsePMOVertices(opaqueShapes[i]);
        }
        for (let i = 0; i < translucentShapeCount; i++) {
            this.parsePMOVertices(translucentShapes[i]);
        }

        let skeleton;
        if (skeletonOffset > 0) {
            this.offset = info.offset + skeletonOffset + 8;
            const boneCount = this.getUshort();
            this.offset += 2;
            const skinnedBoneCount = this.getUshort();
            const skinWeightCount = this.getUshort();
            const bones: PMOBone[] = Array(boneCount);
            for (let i = 0; i < boneCount; i++) {
                const index = this.getUshort();
                this.offset += 2;
                const parentIndex = this.getUshort();
                this.offset += 2;
                const skinnedIndex = this.getUshort();
                this.offset += 6;
                const jointName = this.getString(16);
                const m1 = Array(16);
                const m2 = Array(16);
                for (let j = 0; j < m1.length; j++) {
                    m1[j] = this.getFloat();
                }
                for (let j = 0; j < m1.length; j++) {
                    m2[j] = this.getFloat();
                }
                const transform = mat4.fromValues(
                    m1[0], m1[1], m1[2], m1[3],
                    m1[4], m1[5], m1[6], m1[7],
                    m1[8], m1[9], m1[10], m1[11],
                    m1[12], m1[13], m1[14], m1[15]
                );
                const inverseTransform = mat4.fromValues(
                    m2[0], m2[1], m2[2], m2[3],
                    m2[4], m2[5], m2[6], m2[7],
                    m2[8], m2[9], m2[10], m2[11],
                    m2[12], m2[13], m2[14], m2[15]
                );
                bones[i] = { index, parentIndex, skinnedIndex, jointName, transform, inverseTransform };
            }
            skeleton = { skinnedBoneCount, skinWeightCount, bones };
        }

        return {
            name, position: info.position, rotation: info.rotation, scale: info.scale,
            headerFlags: info.flags, id: info.id, flags, scaleNum: scale, bbox, materials,
            shapes: [...opaqueShapes, ...translucentShapes], ctrts, skeleton
        };
    }

    public parsePAM(): DreamDropPAM {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_PAM) {
            console.warn("Unknown PAM magic", magic);
        }

        this.offset = 4;
        const animationCount = this.getUint32();
        this.offset += 8;

        const infos: AnimationInfo[] = Array(animationCount);
        for (let i = 0; i < animationCount; i++) {
            const offset = this.getUint32();
            const nameOffset = this.getUint32();
            const ret = this.offset;
            this.offset = nameOffset;
            const name = this.getString(14);
            this.offset = ret;
            infos[i] = { offset, name };
        }

        const animations: DreamDropAnimation[] = Array(animationCount);
        for (let i = 0; i < animationCount; i++) {
            this.offset = infos[i].offset;
            const flag = this.getUshort();
            const framerate = this.getByte();
            const interpolateFrameCount = this.getByte();
            const loopFrame = this.getUshort();
            const boneCount = this.getByte();
            this.offset++;
            const frameCount = this.getUshort();
            const returnFrame = this.getUshort();

            const srtFlags: number[] = Array(boneCount);
            for (let j = 0; j < boneCount; j++) {
                srtFlags[j] = this.getUshort();
            }

            const boneSRT: AnimationBoneSRT[] = Array(boneCount);
            for (let j = 0; j < boneCount; j++) {
                const animationFlags = {
                    translationX: getBit(srtFlags[j], 0),
                    translationY: getBit(srtFlags[j], 1),
                    translationZ: getBit(srtFlags[j], 2),
                    rotationX: getBit(srtFlags[j], 3),
                    rotationY: getBit(srtFlags[j], 4),
                    rotationZ: getBit(srtFlags[j], 5),
                    scaleX: getBit(srtFlags[j], 6),
                    scaleY: getBit(srtFlags[j], 7),
                    scaleZ: getBit(srtFlags[j], 8)
                };
                boneSRT[j] = this.parseBoneSRT(animationFlags, frameCount);
            }

            animations[i] = { name: infos[i].name, flag, framerate, interpolateFrameCount, loopFrame, boneCount, frameCount, returnFrame, boneSRT };
        }

        return { animations };
    }

    private parseBoneSRT(flags: AnimationSRTFlags, frameCount: number): AnimationBoneSRT {
        const boneChannel: AnimationBoneSRT = {};

        if (flags.translationX) {
            boneChannel.translationX = this.parseAnimationData(frameCount);
        }
        if (flags.translationY) {
            boneChannel.translationY = this.parseAnimationData(frameCount);
        }
        if (flags.translationZ) {
            boneChannel.translationZ = this.parseAnimationData(frameCount);
        }

        if (flags.rotationX) {
            boneChannel.rotationX = this.parseAnimationData(frameCount);
        }
        if (flags.rotationY) {
            boneChannel.rotationY = this.parseAnimationData(frameCount);
        }
        if (flags.rotationZ) {
            boneChannel.rotationZ = this.parseAnimationData(frameCount);
        }

        if (flags.scaleX) {
            boneChannel.scaleX = this.parseAnimationData(frameCount);
        }
        if (flags.scaleY) {
            boneChannel.scaleY = this.parseAnimationData(frameCount);
        }
        if (flags.scaleZ) {
            boneChannel.scaleZ = this.parseAnimationData(frameCount);
        }

        return boneChannel;
    }

    private parseAnimationData(frameCount: number): AnimationData {
        let keyframeCount = 0;
        const maxValue = this.getFloat();
        const minValue = this.getFloat();
        if (frameCount > 255) {
            keyframeCount = this.getUshort();
        } else {
            keyframeCount = this.getByte();
        }
        const keyframes: AnimationKeyframe[] = Array(keyframeCount);
        if (keyframeCount !== 1) {
            for (let i = 0; i < keyframeCount; i++) {
                let frameId;
                let value;
                if (keyframeCount === frameCount) {
                    frameId = i;
                    value = this.getUshort();
                } else {
                    if (frameCount > 255) {
                        frameId = this.getUshort();
                    } else {
                        frameId = this.getByte();
                    }
                    value = this.getUshort();
                }
                keyframes[i] = { frame: frameId, value };
            }
        }
        return { maxValue, minValue, keyframes };
    }

    private parsePMOShape(): DreamDropPMOShape {
        const vertexCount = this.getUshort();
        const textureId = this.getByte();
        const vertexSizeBytes = this.getByte();
        const vertexFlags = this.getInt32();
        const group = this.getByte(); // ???
        const triangleStripCount = this.getByte(); // unused by dream drop, might be leftover from bbs?
        const attribute = this.getUshort();
        const boneIndices = Array(8);
        for (let i = 0; i < boneIndices.length; i++) {
            boneIndices[i] = this.getByte();
        }
        const unkColor = this.getInt32(); // openkh says diffuse, not sure about that

        return new DreamDropPMOShape(vertexCount, textureId, vertexSizeBytes, vertexFlags, attribute, boneIndices);
    }

    private parsePMOVertices(shape: DreamDropPMOShape) {
        for (let i = 0; i < shape.vertexCount; i++) {
            shape.uvs[i * 2] = this.getShort() / UV_SCALE;
            shape.uvs[(i * 2) + 1] = 1 - this.getShort() / UV_SCALE; // flip

            shape.colors[i * 4] = this.getByte() / COLOR_SCALE;
            shape.colors[(i * 4) + 1] = this.getByte() / COLOR_SCALE;
            shape.colors[(i * 4) + 2] = this.getByte() / COLOR_SCALE;
            shape.colors[(i * 4) + 3] = this.getByte() / COLOR_SCALE;

            // uvs + colors are 8 bytes, so there's shape.vertexSizeBytes - 8 bytes left for remaining data

            if (shape.vertexSizeBytes === 20 || shape.vertexSizeBytes === 28) {
                shape.vertices[i * 3] = this.getFloat() / NORMALIZED_SCALE;
                shape.vertices[(i * 3) + 1] = this.getFloat() / NORMALIZED_SCALE;
                shape.vertices[(i * 3) + 2] = this.getFloat() / NORMALIZED_SCALE;
            } else {
                shape.vertices[i * 3] = this.getShort() / NORMALIZED_SCALE;
                shape.vertices[(i * 3) + 1] = this.getShort() / NORMALIZED_SCALE;
                shape.vertices[(i * 3) + 2] = this.getShort() / NORMALIZED_SCALE;
            }
            if (shape.vertexSizeBytes >= 22) {
                shape.weights = vec4.create(); // i dont trust .fromValues to be in the right order...
                shape.weights[0] = this.getByte() / WEIGHT_SCALE;
                shape.weights[1] = this.getByte() / WEIGHT_SCALE;
                shape.weights[2] = this.getByte() / WEIGHT_SCALE;
                shape.weights[3] = this.getByte() / WEIGHT_SCALE;
                shape.joints = vec4.create();
                shape.joints[0] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[1] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[2] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[3] = Math.trunc(this.getByte() / JOINT_SCALE);
                if (shape.vertexSizeBytes === 26) {
                    this.offset += 4; // skip, normals?
                }
            }
        }
    }

    private parseSet(oloOffset: number, name: string): DreamDropSet {
        this.offset = oloOffset + 6;
        const oloCount = this.getUshort();
        const olos: string[] = Array(oloCount);
        for (let i = 0; i < oloCount; i++) {
            olos[i] = this.getString(4);
        }
        return { name, olos };
    }

    private getString(length: number): string {
        const n = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            n[i] = this.getByte();
        }

        return this.textDecoder.decode(n).trim().replaceAll("\x00", "");
    }

    private getInt32(): number {
        const n = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return n;
    }

    private getUint32(): number {
        const n = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return n;
    }

    private getFloat(): number {
        const n = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return n;
    }

    private getShort(): number {
        const n = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return n;
    }

    private getUshort(): number {
        const n = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return n;
    }

    private getByte(): number {
        const n = this.view.getUint8(this.offset);
        this.offset += 1;
        return n;
    }
}
