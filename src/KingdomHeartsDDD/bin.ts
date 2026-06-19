import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { calcEulerAngleRotationFromSRTMatrix } from "../MathHelpers";
import { LuxBone, LuxBoneChannel, LuxDataSet, LuxKeyframe, LuxMaterial, LuxModel, LuxModelInfo, LuxOLO, LuxOLOInstance, LuxPAM, LuxPMP, LuxShape, LuxSkeletalAnimation, LuxTextureAnimation, LuxTXA, LuxTXAFrame } from "./lux";
import { CTRTFormat } from "./texture";

// Credit for most of the parsing:
// https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Bbs
// https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Ddd
// Some things had to be tweaked or fixed here, but mostly the same

// File types
// CTT: Texture file
// PMO: Model file
// PAM: Skeletal animation
// TXA: Texture animation
// BCD: Raw collision data
// PMP: Pack of PMOs and textures for a single room
// OLO: List of object instances
// MCV: Camera/cutscene related
// LUB: Compiled Lua script
// ESE: Effect file
// FEP: Effect file
// BIN: Many uses and formats

/**
 * Raw model pack for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropPMP extends LuxPMP {
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
    // ctrt = ctr texture
    name: string;
    width: number;
    height: number;
    format: CTRTFormat;
    data: ArrayBufferSlice;
}

/**
 * Raw model for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export interface DreamDropPMO extends LuxModel {
    materials: LuxMaterial[];
    ctrts: DreamDropCTRT[];
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

enum PrimitiveFormat {
    POINT,
    LINE,
    LINE_STRIP,
    TRIANGLE_LIST,
    TRIANGLE_STRIP,
    TRIANGLE_FAN,
    QUAD
}

/**
 * Model shape (mesh) for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropShape extends LuxShape {
    constructor(vertexCount: number, textureIndex: number, attribute: number, boneIndices: number[], public vertexSizeBytes: number, vertexFlags: number) {
        super(vertexCount, textureIndex, attribute, boneIndices);

        const indices = [];
        const primitiveFormat = getBitsRange32(vertexFlags, 28, 4) as PrimitiveFormat;
        switch (primitiveFormat) {
            case PrimitiveFormat.TRIANGLE_STRIP:
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
            case PrimitiveFormat.TRIANGLE_LIST:
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

/**
 * Billboard setting from a model's flag 2nd nibble from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export enum DreamDropModelFlagBillboard {
    BILLBOARD = 4
}

// uint32 at 0x0
const MAGIC_PMP = 5262672;
const MAGIC_PMO = 5197136;
const MAGIC_CTRT = 1414681667;
const MAGIC_SETBIN = 4411969;
const MAGIC_OLO = 1330401088;
const MAGIC_PAM = 5062992;
const MAGIC_TXA = 4282452;

const NORMALIZED_SCALE = 32768.0;
const SHORT_SCALE = 65535.0;
const COLOR_SCALE = 255.0; // standard but might as well
const UV_SCALE = 2048.0;
const JOINT_SCALE = 3.0; // why couldn't they just store the actual index? it's only ever 0 to 7...
const WEIGHT_SCALE = 128.0;

function getBits(n: number, pos: number, size: number) {
    return (n >> pos) & ((1 << size) - 1);
}

function getBit(n: number, pos: number) {
    return getBits(n, pos, 1) !== 0;
}

function getBitsRange32(value: number, start: number = 0, length: number = 1): number {
    return (value << 32 - (start + length)) >> 32 - length;
}

/**
 * Binary parser for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropParser {
    protected view: DataView;
    protected offset: number;
    protected textDecoder: TextDecoder;

    constructor(protected buffer: ArrayBufferSlice) {
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
        const pmoInfos: LuxModelInfo[] = Array(pmoCount);
        let infoRet = this.offset;;
        for (let i = 0; i < pmoCount; i++) {
            this.offset = infoRet;
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
            infoRet = this.offset;
            if (pmoOffset === 0) {
                continue;
            }
            const pmo = this.parsePMO(pmoOffset, false, `${name}_${i}_${id}`, flags);
            pmoInfos[i] = {
                id, flags,
                scale: vec3.fromValues(sx, sy, sz),
                position: vec3.fromValues(px, py, pz),
                rotation: vec3.fromValues(rx, ry, rz),
                pmo
            };
        }

        this.offset = ctrtOffset;
        const ctrts: (DreamDropCTRT | undefined)[] = Array(ctrtCount);
        if (ctrtOffset > 0) {
            const infos: CTRTInfo[] = Array(ctrtCount);
            for (let i = 0; i < ctrtCount; i++) {
                const offset = this.getUint32();
                const name = this.getString(12);
                this.offset += 16;
                infos[i] = { offset, name };
            }

            for (let i = 0; i < ctrtCount; i++) {
                ctrts[i] = this.parseCTRT(infos[i].offset, infos[i].name, false);
            }
        }

        return { pmos: pmoInfos.filter(p => p !== undefined), ctrts: ctrts.filter(t => t !== undefined) };
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
                const format = this.getUint32() as CTRTFormat;
                const width = this.getUshort();
                const height = this.getUshort();
                const data = this.buffer.slice(offset + dataOffset, offset + dataOffset + dataSize);
                return { name, width, height, format, data };
            }
        }
        return undefined;
    }

    public parseSetData(): LuxDataSet[] {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_SETBIN) {
            console.warn("Unknown set magic", magic);
        }
        this.offset = 6;
        const setCount = this.getUshort();
        this.offset = 0x10;

        const sets: LuxDataSet[] = Array(setCount);
        for (let i = 0; i < setCount; i++) {
            this.offset = 0x10 + (32 * i) + 4;
            const setOffset = this.getUint32();
            this.offset += 8;
            const name = this.getString(16);
            sets[i] = this.parseSet(setOffset, name);
        }

        return sets.filter(s => !s.name.includes("evt"));
    }

    public parseOLO(): LuxOLO {
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
        const objects: LuxOLOInstance[] = [];

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

    public parsePMO(offset: number = 0, parseCTRT: boolean = false, name: string = "", pmpFlags: number = -1): DreamDropPMO {
        this.offset = offset;
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

        const materials: LuxMaterial[] = Array(materialCount);
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
                const o = offset + material.textureOffset;
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
            this.offset = offset + opaqueShapeOffset;
        } else if (translucentShapeOffset !== 0) {
            this.offset = offset + translucentShapeOffset;
        }

        // first list is usually all opaque shapes
        const opaqueShapes: DreamDropShape[] = Array(opaqueShapeCount);
        for (let i = 0; i < opaqueShapeCount; i++) {
            opaqueShapes[i] = this.parsePMOShape();
        }
        if (opaqueShapeCount > 0) {
            this.offset += 24;
        }

        // this second list is usually translucent shapes but not always
        const translucentShapes: DreamDropShape[] = Array(translucentShapeCount);
        for (let i = 0; i < translucentShapeCount; i++) {
            translucentShapes[i] = this.parsePMOShape();
        }
        if (translucentShapeCount > 0) {
            this.offset += 24;
        }

        this.offset = offset + vertexDataOffset;
        for (let i = 0; i < opaqueShapeCount; i++) {
            this.parsePMOVertices(opaqueShapes[i]);
        }
        for (let i = 0; i < translucentShapeCount; i++) {
            this.parsePMOVertices(translucentShapes[i]);
        }

        let skeleton;
        if (skeletonOffset > 0) {
            this.offset = offset + skeletonOffset + 8;
            const boneCount = this.getUshort();
            this.offset += 2;
            const skinnedBoneCount = this.getUshort();
            const skinWeightCount = this.getUshort();
            const bones: LuxBone[] = Array(boneCount);
            for (let i = 0; i < boneCount; i++) {
                const index = this.getUshort();
                this.offset += 2;
                const parentIndex = this.getUshort();
                this.offset += 2;
                const skinnedIndex = this.getUshort();
                this.offset += 6;
                const boneName = this.getString(16);
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
                const decomposedTransform = this.decomposeBoneTransform(transform);
                bones[i] = { index, parentIndex, skinnedIndex, name: boneName, transform, inverseTransform, decomposedTransform };
            }
            skeleton = { skinnedBoneCount, skinWeightCount, bones };
        }

        return {
            name, scale, flags, pmpFlags, bbox, materials,
            shapes: [...opaqueShapes, ...translucentShapes], ctrts, skeleton
        };
    }

    public parsePAM(): LuxPAM {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_PAM) {
            console.warn("Unknown PAM magic", magic);
        }

        this.offset = 4;
        const animationCount = this.getUint32();
        this.offset += 6;
        const version = this.getUshort();
        if (version > 2 || version < 1) {
            console.warn("Unimplemented PAM version", version);
        }

        const infos: AnimationInfo[] = Array(animationCount);
        for (let i = 0; i < animationCount; i++) {
            const offset = this.getUint32();
            let name;
            if (version === 1) {
                name = this.getString(12); 
            } else {
                const nameOffset = this.getUint32();
                const ret = this.offset;
                this.offset = nameOffset;
                name = this.getString();
                this.offset = ret;
            }
            infos[i] = { offset, name };
        }

        const animations: LuxSkeletalAnimation[] = Array(animationCount);
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

            const boneSRT: LuxBoneChannel[] = Array(boneCount);
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

            animations[i] = { name: infos[i].name, flag, framerate, interpolateFrameCount, loopFrame, boneCount, frameCount, returnFrame, channels: boneSRT };
        }

        return { animations };
    }

    public parseTXA(ctrts: DreamDropCTRT[]): LuxTXA[] {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_TXA) {
            console.warn("Unknown TXA magic", magic);
        }
        this.offset += 2;
        const count = this.getUshort();
        this.offset += 8;

        const txas: LuxTXA[] = Array(count);
        for (let i = 0; i < count; i++) {
            const name = this.getString(16);
            const textureName = this.getString(24);
            this.offset += 8;
            const animationCount = this.getShort();
            const defaultAnimationIndex = this.getShort();
            const animationOffset = this.getUint32();

            const ret1 = this.offset;
            const animations: LuxTextureAnimation[] = Array(animationCount);
            this.offset = animationOffset;
            for (let j = 0; j < animationCount; j++) {
                const animationName = this.getString(16);
                this.offset += 2;
                const frameCount = this.getShort();
                const frameOffset = this.getUint32();

                const ret2 = this.offset;
                const frames: LuxTXAFrame[] = [];
                this.offset = frameOffset;
                for (let k = 0; k < frameCount; k++) {
                    const dataOffset = this.getUint32();
                    const displayFrames = this.getShort();
                    const num2 = this.getShort(); // unknown
                    this.offset += 4;
                    if (dataOffset === 0) {
                        continue;
                    }
                    const ctrt = ctrts.find(t => t.name === textureName);
                    if (!ctrt || dataOffset + ctrt.data.byteLength > this.buffer.byteLength) {
                        continue;
                    }
                    const data = this.buffer.slice(dataOffset, dataOffset + ctrt.data.byteLength);
                    frames.push({ displayFrames, data });
                }

                this.offset = ret2;
                animations[j] = { name: animationName, frames };
            }

            this.offset = ret1;
            txas[i] = { name, textureName, defaultAnimationIndex, animations };
        }

        return txas;
    }

    private parseBoneSRT(flags: AnimationSRTFlags, frameCount: number): LuxBoneChannel {
        let translationX: LuxKeyframe[] = [];
        let translationY: LuxKeyframe[] = [];
        let translationZ: LuxKeyframe[] = [];
        let rotationX: LuxKeyframe[] = [];
        let rotationY: LuxKeyframe[] = [];
        let rotationZ: LuxKeyframe[] = [];
        let scaleX: LuxKeyframe[] = [];
        let scaleY: LuxKeyframe[] = [];
        let scaleZ: LuxKeyframe[] = [];

        if (flags.translationX) {
            translationX = this.parseAnimationData(frameCount);
        }
        if (flags.translationY) {
            translationY = this.parseAnimationData(frameCount);
        }
        if (flags.translationZ) {
            translationZ = this.parseAnimationData(frameCount);
        }

        if (flags.rotationX) {
            rotationX = this.parseAnimationData(frameCount);
        }
        if (flags.rotationY) {
            rotationY = this.parseAnimationData(frameCount);
        }
        if (flags.rotationZ) {
            rotationZ = this.parseAnimationData(frameCount);
        }

        if (flags.scaleX) {
            scaleX = this.parseAnimationData(frameCount);
        }
        if (flags.scaleY) {
            scaleY = this.parseAnimationData(frameCount);
        }
        if (flags.scaleZ) {
            scaleZ = this.parseAnimationData(frameCount);
        }

        return { translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ };
    }

    private parseAnimationData(frameCount: number): LuxKeyframe[] {
        let keyframeCount = 0;
        const maxValue = this.getFloat();
        const minValue = this.getFloat();
        if (frameCount > 255) {
            keyframeCount = this.getUshort();
        } else {
            keyframeCount = this.getByte();
        }
        const keyframes: LuxKeyframe[] = Array(keyframeCount);
        if (keyframeCount !== 1) {
            for (let i = 0; i < keyframeCount; i++) {
                let frame;
                let value;
                if (keyframeCount === frameCount) {
                    frame = i;
                    value = this.getUshort() / SHORT_SCALE;
                } else {
                    if (frameCount > 255) {
                        frame = this.getUshort();
                    } else {
                        frame = this.getByte();
                    }
                    value = this.getUshort() / SHORT_SCALE;
                }
                keyframes[i] = { frame, value: minValue + value * (maxValue - minValue) };
            }
        } else {
            return [{ frame: 0, value: minValue }];
        }
        return keyframes.filter(k => k !== undefined);
    }

    private parsePMOShape(): DreamDropShape {
        const vertexCount = this.getUshort();
        const textureId = this.getByte();
        const vertexSizeBytes = this.getByte();
        const vertexFlags = this.getInt32();
        this.offset += 2;
        const attribute = this.getUshort();
        const boneIndices = Array(8);
        for (let i = 0; i < boneIndices.length; i++) {
            boneIndices[i] = this.getByte();
        }
        const unkColor = this.getInt32(); // openkh says diffuse, not sure about that

        return new DreamDropShape(vertexCount, textureId, attribute, boneIndices, vertexSizeBytes, vertexFlags);
    }

    private parsePMOVertices(shape: DreamDropShape) {
        if (shape.vertexSizeBytes >= 22) {
            shape.weights = new Float32Array(shape.vertexCount * 4);
            shape.joints = new Uint8Array(shape.vertexCount * 4);
        }
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
                shape.weights[i * 4] = this.getByte() / WEIGHT_SCALE;
                shape.weights[(i * 4) + 1] = this.getByte() / WEIGHT_SCALE;
                shape.weights[(i * 4) + 2] = this.getByte() / WEIGHT_SCALE;
                shape.weights[(i * 4) + 3] = this.getByte() / WEIGHT_SCALE;
                shape.joints[i * 4] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[(i * 4) + 1] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[(i * 4) + 2] = Math.trunc(this.getByte() / JOINT_SCALE);
                shape.joints[(i * 4) + 3] = Math.trunc(this.getByte() / JOINT_SCALE);
                if (shape.vertexSizeBytes === 26) {
                    this.offset += 4;
                }
            }
        }
    }

    private parseSet(oloOffset: number, name: string): LuxDataSet {
        this.offset = oloOffset + 6;
        const oloCount = this.getUshort();
        const olos: string[] = Array(oloCount);
        for (let i = 0; i < oloCount; i++) {
            olos[i] = this.getString(4);
        }
        return { name, olos };
    }

    protected decomposeBoneTransform(transform: ReadonlyMat4): { scale: vec3, rotation: vec3, translation: vec3 } {
        const scale = vec3.create();
        const rotation = vec3.create();
        const translation = vec3.create();
        mat4.getScaling(scale, transform);
        calcEulerAngleRotationFromSRTMatrix(rotation,transform);
        mat4.getTranslation(translation, transform);
        return { scale, rotation, translation };
    }

    protected getString(length?: number): string {
        let s = "";
        if (length) {
            const n = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                n[i] = this.getByte();
            }
            s = this.textDecoder.decode(n);
        } else {
            // null-terminated string
            const n = [];
            while (true) {
                const b = this.getByte();
                if (b === 0 || n.length > 999 || this.offset >= this.view.byteLength) {
                    break;
                } else {
                    n.push(b);
                }
            }
            s = this.textDecoder.decode(new Uint8Array(n));
        }
        return s.trim().replaceAll("\x00", "");
    }

    protected getInt32(): number {
        const n = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return n;
    }

    protected getUint32(): number {
        const n = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return n;
    }

    protected getFloat(): number {
        const n = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return n;
    }

    protected getShort(): number {
        const n = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return n;
    }

    protected getUshort(): number {
        const n = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return n;
    }

    protected getByte(): number {
        const n = this.view.getUint8(this.offset);
        this.offset += 1;
        return n;
    }
}
