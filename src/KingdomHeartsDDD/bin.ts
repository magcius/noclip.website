import { vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DreamDropTextureFormat } from "./texture";

// Credit: https://github.com/OpenKH/OpenKh/tree/master/OpenKh.Ddd

/**
 * Data from a PMP for _Kingdom Hearts 3D: Dream Drop Distance_
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
 * Texture data from a CTRT for _Kingdom Hearts 3D: Dream Drop Distance_
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
 * Model data from a PMO for _Kingdom Hearts 3D: Dream Drop Distance_
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
    mainShapes: DreamDropPMOShape[];
    secondShapes: DreamDropPMOShape[];
}

interface PMOMaterial {
    textureOffset: number;
    textureName: string;
    scrollX: number;
    scrollY: number;
}

export class DreamDropPMOShape {
    public vertices: PMOVertex[];
    public indices: number[];
    // public isTriangleStrip: boolean;
    // public uvFormat: PMOVertexFormat;
    // public normalFormat: PMOVertexFormat;
    // public positionFormat: PMOVertexFormat;
    // public weightFormat: PMOVertexFormat;
    // public indicesFormat: number;
    // public skinWeightsCount: number;
    // public morphWeightsCount: number;
    // public uniformDiffuse: boolean;
    public primitiveFormat: PMOPrimitiveFormat;

    constructor(public vertexCount: number, public textureIndex: number, public vertexSizeBytes: number, public vertexFlags: number, public group: number, public triangleStripCount: number, public attribute: number, public boneIndices: number[], public diffuseColor: number) {
        this.vertices = Array(vertexCount);
        // this.isTriangleStrip = getBit(vertexFlags, 30);
        // this.uvFormat = getBitsRange(vertexFlags, 0, 2) as PMOVertexFormat;
        // this.normalFormat = getBitsRange(vertexFlags, 5, 2) as PMOVertexFormat;
        // this.positionFormat = getBitsRange(vertexFlags, 7, 2) as PMOVertexFormat;
        // this.weightFormat = getBitsRange(vertexFlags, 9, 2) as PMOVertexFormat;
        // this.indicesFormat = getBitsRange(vertexFlags, 11, 2);
        // this.skinWeightsCount = getBitsRange(vertexFlags, 14, 3);
        // this.morphWeightsCount = getBitsRange(vertexFlags, 18, 3);
        // this.uniformDiffuse = getBitsRange(vertexFlags, 24, 1) === 1;
        this.primitiveFormat = getBitsRange(vertexFlags, 28, 4) as PMOPrimitiveFormat;

        this.indices = [];
        switch (this.primitiveFormat) {
            case PMOPrimitiveFormat.TRIANGLE_STRIP:
                for (let i = 0; i < this.vertexCount - 2; i++) {
                    if (i % 2 === 0) {
                        this.indices.push(i);
                        this.indices.push(i + 1);
                        this.indices.push(i + 2);
                    } else {
                        this.indices.push(i + 1);
                        this.indices.push(i);
                        this.indices.push(i + 2);
                    }
                }
                break;
            case PMOPrimitiveFormat.TRIANGLE_LIST:
                for (let i = 0; i < this.vertexCount - 2; i += 3) {
                    this.indices.push(i);
                    this.indices.push(i + 1);
                    this.indices.push(i + 2);
                }
                break;
            default:
                console.warn("Unimplemented primitive format", this.primitiveFormat);
                break;
        }
    }
}

interface PMOVertex {
    uv: vec2;
    color: vec4;
    position: vec3;
    weight: vec4;
    joint: vec4;
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

const MAGIC_PMP = 5262672;
const MAGIC_CTRT = 1414681667;

function getBits(n: number, pos: number, size: number) {
    return (n >> pos) & ((1 << size) - 1);
}

function getBit(n: number, pos: number) {
    return getBits(n, pos, 1) !== 0;
}

function getBitsRange(value: number, start: number = 0, length: number = 1): number {
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
            console.log(ctrtOffset, ctrtCount);
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
            pmos[i] = this.parsePMO(pmoInfo[i]);
        }

        return { pmos, ctrts };
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
            materials[i] = { textureOffset, textureName, scrollX, scrollY };
        }

        const mainShapeOffset = this.getUint32();
        const secondShapeOffset = this.getUint32();
        const mainVertexCount = this.getUint32();
        const secondVertexCount = this.getUint32();
        const mainShapeCount = this.getUint32();
        const secondShapeCount = this.getUint32();
        const vertexDataOffset = this.getUint32();
        const vertexDataSize = this.getUint32();

        this.offset += 8;

        // mesh names are here, skipping

        if (mainShapeOffset !== 0) {
            this.offset = info.offset + mainShapeOffset;
        } else if (secondShapeOffset !== 0) {
            this.offset = info.offset + secondShapeOffset;
        }

        const mainShapes: DreamDropPMOShape[] = Array(mainShapeCount);
        for (let i = 0; i < mainShapeCount; i++) {
            mainShapes[i] = this.parsePMOShape();
        }
        if (mainShapeCount > 0) {
            this.offset += 24;
        }

        const secondShapes: DreamDropPMOShape[] = Array(secondShapeCount);
        for (let i = 0; i < secondShapeCount; i++) {
            secondShapes[i] = this.parsePMOShape();
        }
        if (secondShapeCount > 0) {
            this.offset += 24;
        }

        this.offset = info.offset + vertexDataOffset;
        for (let i = 0; i < mainShapeCount; i++) {
            this.parsePMOVertices(mainShapes[i]);
        }
        for (let i = 0; i < secondShapeCount; i++) {
            this.parsePMOVertices(secondShapes[i]);
        }

        return { position: info.position, rotation: info.rotation, scale: info.scale, headerFlags: info.flags, id: info.id, flags, scaleNum: scale, bbox, materials, mainShapes, secondShapes };
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
            const uv = vec2.fromValues(0, 0);
            const color = vec4.fromValues(0, 0, 0, 0);
            const position = vec3.fromValues(0, 0, 0);
            const weight = vec4.fromValues(0, 0, 0, 0);
            const joint = vec4.fromValues(0, 0, 0, 0);

            // uv format is always (confirm?) 16 bit norm
            uv[0] = this.getShort() / 32768.0;
            uv[1] = this.getShort() / 32768.0;
            // treat colors as rgba8888, need to confirm. Might be abgr8888
            color[0] = this.getByte() / 255.0;
            color[1] = this.getByte() / 255.0;
            color[2] = this.getByte() / 255.0;
            color[3] = this.getByte() / 255.0;

            switch (shape.vertexSizeBytes) {
                case 14:
                    position[0] = this.getShort() / 32768.0;
                    position[1] = this.getShort() / 32768.0;
                    position[2] = this.getShort() / 32768.0;
                    break;
                case 20:
                    position[0] = this.getFloat();
                    position[1] = this.getFloat();
                    position[2] = this.getFloat();
                    break;
                case 22:
                case 26:
                    position[0] = this.getShort() / 32768.0;
                    position[1] = this.getShort() / 32768.0;
                    position[2] = this.getShort() / 32768.0;
                    weight[0] = this.getByte();
                    weight[1] = this.getByte();
                    weight[2] = this.getByte();
                    weight[3] = this.getByte();
                    joint[0] = this.getByte();
                    joint[1] = this.getByte();
                    joint[2] = this.getByte();
                    joint[3] = this.getByte();
                    if (shape.vertexSizeBytes === 26) {
                        this.offset += 4;
                    }
                    break;
                case 28:
                    position[0] = this.getFloat();
                    position[1] = this.getFloat();
                    position[2] = this.getFloat();
                    weight[0] = this.getByte();
                    weight[1] = this.getByte();
                    weight[2] = this.getByte();
                    weight[3] = this.getByte();
                    joint[0] = this.getByte();
                    joint[1] = this.getByte();
                    joint[2] = this.getByte();
                    joint[3] = this.getByte();
                    break;
                default:
                    console.warn("Unimplemented vertex size", shape.vertexSizeBytes);
                    break;
            }
            shape.vertices[i] = { uv, color, position, weight, joint };
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
