import { mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DreamDropTextureFormat } from "./texture";

// Credit: https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Ddd

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
    uvX: number;
    uvY: number;
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
    uvX: number;
    uvY: number;
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
    id: number;
    position: vec3;
    rotation: vec3;
    scale: vec3;
    scaleNum: number;
    flags: number;
    headerFlags: number;
    bbox: number[];
    materials: PMOMaterial[];
    opaqueShapes: DreamDropPMOShape[];
    translucentShapes: DreamDropPMOShape[];
    skeleton?: PMOSkeleton;
}

interface PMOMaterial {
    textureName: string;
    scrollX: number;
    scrollY: number;
}

interface PMOSkeleton {
    skinnedBoneCount: number;
    nStdBone: number;
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
 * Raw model shape for _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropPMOShape {
    public vertices: Float32Array;
    public colors: Float32Array;
    public uvs: Float32Array;
    public indices: Uint32Array;
    public primitiveFormat: PMOPrimitiveFormat;

    constructor(public vertexCount: number, public textureIndex: number, public vertexSizeBytes: number, public vertexFlags: number, public group: number, public triangleStripCount: number, public attribute: number, public boneIndices: number[], public diffuseColor: number) {
        this.vertices = new Float32Array(vertexCount * 3);
        this.colors = new Float32Array(vertexCount * 4);
        this.uvs = new Float32Array(vertexCount * 2);
        this.primitiveFormat = getBitsRange32(vertexFlags, 28, 4) as PMOPrimitiveFormat;

        const indices = [];
        switch (this.primitiveFormat) {
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
                console.warn("Unimplemented primitive format", this.primitiveFormat);
                break;
        }
        this.indices = new Uint32Array(indices);
    }
}

const MAGIC_PMP = 5262672;
const MAGIC_CTRT = 1414681667;
const NORMALIZED_SCALE = 32768.0;
const UV_SCALE = 2048.0; // best guess

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

    public parsePMP(): DreamDropPMP {
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
        const ctrts: DreamDropCTRT[] = Array(ctrtCount);
        if (ctrtOffset > 0) {
            const ctrtInfo: CTRTInfo[] = Array(ctrtCount);
            for (let i = 0; i < ctrtCount; i++) {
                const offset = this.getUint32();
                const name = this.getString(12);
                const uvX = this.getFloat();
                const uvY = this.getFloat();
                this.offset += 8;
                ctrtInfo[i] = { offset, name, uvX, uvY };
            }

            for (let i = 0; i < ctrtCount; i++) {
                const info = ctrtInfo[i];
                this.offset = info.offset;
                if (this.offset === 0) {
                    continue;
                }
                const ctrtMagic = this.getUint32();
                if (ctrtMagic !== MAGIC_CTRT) {
                    console.warn("Unknown CTRT magic", ctrtMagic);
                } else {
                    this.offset = info.offset + 12;
                    const dataOffset = this.getUint32();
                    this.offset += 4;
                    const dataSize = this.getUint32();
                    this.offset += 4;
                    const format = this.getUint32() as DreamDropTextureFormat;
                    const width = this.getUshort();
                    const height = this.getUshort();
                    const data = this.buffer.slice(info.offset + dataOffset, info.offset + dataOffset + dataSize);
                    ctrts[i] = { name: info.name, width, height, format, data, uvX: info.uvX, uvY: info.uvY };
                }
            }
        }

        const pmos: DreamDropPMO[] = Array(pmoCount);
        for (let i = 0; i < pmoCount; i++) {
            if (pmoInfo[i].offset === 0) {
                continue;
            }
            pmos[i] = this.parsePMO(pmoInfo[i]);
        }

        return { pmos: pmos.filter(p => p !== undefined), ctrts: ctrts.filter(t => t !== undefined) };
    }

    private parsePMO(info: PMOInfo): DreamDropPMO {
        this.offset = info.offset + 5;
        const modelCount = this.getByte();
        const version = this.getByte();
        this.offset++;
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

        const materials: PMOMaterial[] = Array(materialCount);
        for (let i = 0; i < materialCount; i++) {
            const textureOffset = this.getUint32();
            const textureName = this.getString(12);
            const scrollX = this.getFloat();
            const scrollY = this.getFloat();
            this.offset += 8;
            materials[i] = { textureName, scrollX, scrollY };
        }

        const mainShapeOffset = this.getUint32();
        const secondShapeOffset = this.getUint32();
        const mainVertexCount = this.getUint32();
        const secondVertexCount = this.getUint32();
        const opaqueShapeCount = this.getUint32();
        const translucentShapeCount = this.getUint32();
        const vertexDataOffset = this.getUint32();
        const vertexDataSize = this.getUint32();

        this.offset += 8;

        // mesh names are here, skipping

        if (mainShapeOffset !== 0) {
            this.offset = info.offset + mainShapeOffset;
        } else if (secondShapeOffset !== 0) {
            this.offset = info.offset + secondShapeOffset;
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
            const nStdBone = this.getUshort();
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
            skeleton = { skinnedBoneCount, nStdBone, bones };
        }

        return {
            position: info.position, rotation: info.rotation, scale: info.scale,
            headerFlags: info.flags, id: info.id, flags, scaleNum: scale, bbox, materials,
            opaqueShapes, translucentShapes, skeleton
        };
    }

    private parsePMOShape(): DreamDropPMOShape {
        const vertexCount = this.getUshort();
        const textureId = this.getByte();
        const vertexSizeBytes = this.getByte();
        const vertexFlags = this.getInt32();
        const group = this.getByte();
        const triangleStripCount = this.getByte();
        const attribute = this.getUshort();
        const boneIndices = Array(8);
        for (let k = 0; k < boneIndices.length; k++) {
            boneIndices[k] = this.getByte();
        }
        const diffuseColor = this.getInt32();

        return new DreamDropPMOShape(vertexCount, textureId, vertexSizeBytes, vertexFlags, group, triangleStripCount, attribute, boneIndices, diffuseColor);
    }

    private parsePMOVertices(shape: DreamDropPMOShape) {
        for (let i = 0; i < shape.vertexCount; i++) {
            shape.uvs[i * 2] = this.getShort() / UV_SCALE;
            shape.uvs[(i * 2) + 1] = 1 - this.getShort() / UV_SCALE; // flip

            shape.colors[i * 4] = this.getByte() / 255.0;
            shape.colors[(i * 4) + 1] = this.getByte() / 255.0;
            shape.colors[(i * 4) + 2] = this.getByte() / 255.0;
            shape.colors[(i * 4) + 3] = this.getByte() / 255.0;

            switch (shape.vertexSizeBytes) {
                case 14:
                case 22:
                case 26:
                    shape.vertices[i * 3] = this.getShort() / NORMALIZED_SCALE;
                    shape.vertices[(i * 3) + 1] = this.getShort() / NORMALIZED_SCALE;
                    shape.vertices[(i * 3) + 2] = this.getShort() / NORMALIZED_SCALE;
                    if (shape.vertexSizeBytes >= 22) {
                        this.offset += 8;
                        if (shape.vertexSizeBytes === 26) {
                            this.offset += 4;
                        }
                    }
                    break;
                case 20:
                case 28:
                    shape.vertices[i * 3] = this.getFloat() / NORMALIZED_SCALE;
                    shape.vertices[(i * 3) + 1] = this.getFloat() / NORMALIZED_SCALE;
                    shape.vertices[(i * 3) + 2] = this.getFloat() / NORMALIZED_SCALE;
                    if (shape.vertexSizeBytes === 28) {
                        this.offset += 8;
                    }
                    break;
                default:
                    console.warn("Unimplemented vertex size", shape.vertexSizeBytes);
                    break;
            }
        }
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
