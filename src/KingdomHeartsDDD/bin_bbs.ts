import { vec3 } from "gl-matrix";
import { DreamDropParser } from "./bin";
import { LuxModel, LuxModelInfo, LuxPMP, LuxShape } from "./lux";
import ArrayBufferSlice from "../ArrayBufferSlice";

const MAGIC_ARC = 4411969;
const MAGIC_PMP = 5262672;
const MAGIC_PMO = 5197136;
const MAGIC_TIM2 = 843925844;

const NORMALIZED_8_SCALE = 128.0;
const NORMALIZED_16_SCALE = 32768.0;
const COLOR_SCALE = 255.0;

interface ArcEntry {
    dirPointer: number;
    offset: number;
    size: number;
    name: string;
}

enum CoordinateFormat {
    NO_VERTEX,
    NORMALIZED_8_BITS,
    NORMALIZED_16_BITS,
    FLOAT_32_BITS
}

enum ColorFormat {
    NO_COLOR,
    BGR_5650_16BITS = 4,
    ABGR_5551_16BITS,
    ABGR_4444_16BITS,
    ABGR_8888_32BITS,
}

enum PrimitiveType {
    PRIMITIVE_POINT,
    PRIMITIVE_LINE,
    PRIMITIVE_LINE_STRIP,
    PRIMITIVE_TRIANGLE,
    PRIMITIVE_TRIANGLE_STRIP,
    PRIMITIVE_TRIANGLE_FAN,
    PRIMITIVE_QUAD
}

interface ShapeFlags {
    uvFormat: CoordinateFormat;
    colorFormat: ColorFormat;
    normalFormat: CoordinateFormat;
    vertexFormat: CoordinateFormat;
    weightFormat: CoordinateFormat;
    skinWeightCount: number;
    uniformDiffuse: boolean;
    primitive: PrimitiveType;
}

export interface BBSPMP extends LuxPMP {
    tims: TIM2[];
}

export interface BBSModel extends LuxModel {
    textureNames: string[];
}

interface TIM2Info {
    offset: number;
    name: string;
    scrollX: number;
    scrollY: number;
}

export interface TIM2 {
    name: string;
    scrollX: number;
    scrollY: number;
    data: ArrayBufferSlice;
}

export interface ParsedTIM2 {
    dataOffset: number;
    pixelFormat: BBSPixelFormat;
    clutFormat: BBSPixelFormat;
    totalSize: number;
    clutSize: number;
    imageSize: number;
    headerSize: number;
    clutColorCount: number;
    pictureFormat: number;
    mipCount: number;
    clutType: number;
    imageType: number;
    width: number;
    height: number;
}

export enum BBSPixelFormat {
    UNKNOWN,
    INDEXED_4,
    INDEXED_8,
    RGBA_1555,
    RGB_888,
    RGBX_8888,
    RGBA_888
}

function getBitsRange32(value: number, start: number = 0, length: number = 1): number {
    return ((value << (32 - (start + length))) >>> 0) >>> (32 - length);
}

export class BBSShape extends LuxShape {
    constructor(vertexCount: number, textureIndex: number, attribute: number, boneIndices: number[], triStripValues: number[], flags: ShapeFlags) {
        super(vertexCount, textureIndex, attribute, boneIndices);

        const indices = [];
        if (triStripValues.length > 0) {
            let index = 0;
            for (let i = 0; i < triStripValues.length; i++) {
                for (let j = 0; j < triStripValues[i] - 2; j++) {
                    indices.push(index + j);
                    if (j % 2 === 0) {
                        indices.push(index + j + 1);
                        indices.push(index + j + 2);
                    } else {
                        indices.push(index + j + 2);
                        indices.push(index + j + 1);
                    }
                }
                index += triStripValues[i];
            }
        } else if (flags.primitive === PrimitiveType.PRIMITIVE_TRIANGLE_STRIP) {
            for (let i = 0; i < vertexCount - 2; i++) {
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
        } else if (flags.primitive === PrimitiveType.PRIMITIVE_TRIANGLE) {
            for (let i = 0; i < vertexCount; i++) {
                indices.push(i);
            }
        } else {
            console.warn("Unknown index primitive type", flags.primitive);
        }
        this.indices = new Uint32Array(indices);
    }
}

export class BBSParser extends DreamDropParser {
    public parsePMPFromARC(): BBSPMP | undefined {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_ARC) {
            console.warn("Unknown ARC magic", magic);
        }

        this.offset += 2;
        const count = this.getShort();
        this.offset += 8;
        const entries: ArcEntry[] = Array(count);
        for (let i = 0; i < count; i++) {
            const dirPointer = this.getUint32();
            const offset = this.getInt32();
            const size = this.getInt32();
            this.offset += 4;
            const name = this.getString(16);
            entries[i] = { dirPointer, offset, size, name };
        }

        const pmpEntry = entries.find(e => e.name.toLowerCase().includes(".pmp"));
        if (!pmpEntry || pmpEntry?.dirPointer !== 0) {
            console.warn("Could not find PMP entry in ARC", entries);
            return undefined;
        } else {
            return this.getPMP(pmpEntry.offset);
        }
    }

    public parseTIM2(): ParsedTIM2 {
        this.offset = 0;
        const magic = this.getUint32();
        if (magic !== MAGIC_TIM2) {
            console.warn("Unknown TIM2 magic", magic);
        }

        this.offset = 5;
        const format = this.getByte();
        this.offset += 10;

        if (format !== 0) {
            this.offset += 128;
        }

        const totalSize = this.getUint32();
        const clutSize = this.getUint32();
        const imageSize = this.getUint32();
        const headerSize = this.getUshort();
        const clutColorCount = this.getUshort();
        const pictureFormat = this.getByte();
        const mipCount = this.getByte();
        const clutType = this.getByte();
        const imageType = this.getByte();
        const width = this.getShort();
        const height = this.getShort();
        this.offset += 24;

        return {
            totalSize, clutSize, imageSize, headerSize, clutColorCount, pictureFormat, mipCount, clutType, imageType, width, height,
            dataOffset: this.offset, pixelFormat: this.convertPixelFormat(imageType), clutFormat: this.convertPixelFormat(clutType & 7)
        };
    }

    private getPMP(start: number): BBSPMP {
        this.offset = start;
        const magic = this.getUint32();
        if (magic !== MAGIC_PMP) {
            console.warn("Unknown PMP magic", magic);
        }

        this.offset += 11;
        const mapFlag = this.getByte();
        const objectCount = this.getUshort();
        const modelCount = this.getUshort();
        this.offset += 6;
        const textureCount = this.getUshort();
        const textureOffset = this.getUint32();

        const pmos: LuxModelInfo[] = Array(objectCount);
        for (let i = 0; i < objectCount; i++) {
            const px = this.getFloat();
            const py = this.getFloat();
            const pz = this.getFloat();
            const rx = this.getFloat();
            const ry = this.getFloat();
            const rz = this.getFloat();
            const sx = this.getFloat();
            const sy = this.getFloat();
            const sz = this.getFloat();
            const offset = this.getUint32();
            this.offset += 4;
            const flags = this.getUshort();
            const id = this.getUshort();
            const ret = this.offset;
            if (offset === 0) {
                continue;
            } else {
                this.offset = start + offset;
                const pmo = this.getPMO(`pmo_${i}`, flags);
                pmos[i] = { id, flags, position: vec3.fromValues(px, py, pz), rotation: vec3.fromValues(rx, ry, rz), scale: vec3.fromValues(sx, sy, sz), pmo };
                this.offset = ret;
            }
        }

        this.offset = start + textureOffset;
        const timInfos: TIM2Info[] = Array(textureCount);
        for (let i = 0; i < textureCount; i++) {
            const dataOffset = this.getUint32();
            const name = this.getString(12);
            const scrollX = this.getFloat();
            const scrollY = this.getFloat();
            this.offset += 8;
            timInfos[i] = { name, offset: dataOffset, scrollX, scrollY };
        }

        const tims: TIM2[] = Array(textureCount);
        for (let i = 0; i < textureCount; i++) {
            if (timInfos[i].offset === 0) {
                continue;
            }
            this.offset = start + timInfos[i].offset + 16;
            const size = this.getUint32();
            const data = this.buffer.slice(start + timInfos[i].offset, start + timInfos[i].offset + size - 16);
            tims[i] = { name: timInfos[i].name, scrollX: timInfos[i].scrollX, scrollY: timInfos[i].scrollY, data };
        }

        return { pmos: pmos.filter(p => p.pmo !== undefined), tims: tims.filter(t => t !== undefined) };
    }

    private getPMO(name: string, pmpFlags: number): BBSModel {
        const start = this.offset;
        const magic = this.getUint32();
        if (magic !== MAGIC_PMO) {
            console.warn("Unknown PMO magic", magic);
        }

        this.offset += 4;
        const textureCount = this.getByte();
        this.offset++;
        const flags = this.getUshort();
        const skeletonOffset = this.getUint32();
        const mesh0Offset = this.getUint32();
        this.offset += 4;
        const scale = this.getFloat();
        const mesh1Offset = this.getUint32();
        const bbox: number[] = Array(32);
        for (let i = 0; i < bbox.length; i++) {
            bbox[i] = this.getFloat();
        }

        const textureNames = Array(textureCount);
        for (let i = 0; i < textureCount; i++) {
            this.offset += 4;
            textureNames[i] = this.getString(12);
            this.offset += 16;
        }

        const shapes: BBSShape[] = [];
        if (mesh0Offset !== 0) {
            this.offset = start + mesh0Offset;
            shapes.push(...this.getShapes(skeletonOffset !== 0));
        }
        if (mesh1Offset !== 0) {
            this.offset = start + mesh1Offset;
            shapes.push(...this.getShapes(skeletonOffset !== 0));
        }

        return { name, scale, flags, pmpFlags, bbox, shapes, textureNames };
    }

    private getShapes(hasSkeleton: boolean): BBSShape[] {
        const shapes: BBSShape[] = [];

        let counter = 0xFFFF;
        while (counter > 0) {
            const vertexCount = this.getUshort();
            const textureIndex = this.getByte();
            const vertexSizeBytes = this.getByte();
            const vertexFlags = this.getUint32();
            this.offset += 1;
            const triStripCount = this.getByte();
            const attribute = this.getUshort();

            if (vertexCount <= 0) {
                break;
            }

            const flags: ShapeFlags = {
                uvFormat: getBitsRange32(vertexFlags, 0, 2) as CoordinateFormat,
                colorFormat: getBitsRange32(vertexFlags, 2, 3) as ColorFormat,
                normalFormat: getBitsRange32(vertexFlags, 5, 2) as CoordinateFormat,
                vertexFormat: getBitsRange32(vertexFlags, 7, 2) as CoordinateFormat,
                weightFormat: getBitsRange32(vertexFlags, 9, 2) as CoordinateFormat,
                skinWeightCount: getBitsRange32(vertexFlags, 14, 3) as CoordinateFormat,
                uniformDiffuse: getBitsRange32(vertexFlags, 24, 1) === 1,
                primitive: getBitsRange32(vertexFlags, 28, 4) as PrimitiveType
            };

            const boneIndices: number[] = Array(8).fill(-1);
            if (hasSkeleton) {
                for (let i = 0; i < boneIndices.length; i++) {
                    boneIndices[i] = this.getByte();
                }
            }
            let diffuse = 0;
            if (flags.uniformDiffuse) {
                diffuse = this.getUint32();
            }
            const triStripValues: number[] = Array(triStripCount);
            for (let i = 0; i < triStripCount; i++) {
                triStripValues[i] = this.getUshort();
            }

            const ret = this.offset;
            const shape = new BBSShape(vertexCount, textureIndex, attribute, boneIndices, triStripValues, flags);
            const w = flags.skinWeightCount + 1;
            shape.weights = new Float32Array(vertexCount * w);
            for (let i = 0; i < vertexCount; i++) {
                const ret2 = this.offset;
                let incAmount = 0;

                if (hasSkeleton && flags.weightFormat != CoordinateFormat.NO_VERTEX) {
                    for (let j = 0; j < w; j++) {
                        switch (flags.weightFormat) {
                            case CoordinateFormat.NORMALIZED_8_BITS:
                                shape.weights[(i * w) + j] = this.getByte() / NORMALIZED_8_SCALE;
                                break;
                            case CoordinateFormat.NORMALIZED_16_BITS:
                                shape.weights[(i * w) + j] = this.getUshort() / NORMALIZED_16_SCALE;
                                break;
                            case CoordinateFormat.FLOAT_32_BITS:
                                shape.weights[(i * w) + j] = this.getFloat();
                            default:
                                console.warn("Unimplemented weight format", flags.weightFormat);
                                shape.weights[(i * w) + j] = 0;
                                break;
                        }
                    }
                }

                switch (flags.uvFormat) {
                    case CoordinateFormat.NORMALIZED_8_BITS:
                        shape.uvs[i * 2] = this.getByte() / NORMALIZED_8_SCALE;
                        shape.uvs[(i * 2) + 1] = this.getByte() / NORMALIZED_8_SCALE;
                        break;
                    case CoordinateFormat.NORMALIZED_16_BITS:
                        incAmount = (2 - ((this.offset - ret2) & 1)) & 1;
                        this.offset += incAmount;
                        shape.uvs[i * 2] = this.getUshort() / NORMALIZED_16_SCALE;
                        shape.uvs[(i * 2) + 1] = this.getUshort() / NORMALIZED_16_SCALE;
                        break;
                    case CoordinateFormat.FLOAT_32_BITS:
                        incAmount = (4 - ((this.offset - ret2) & 3)) & 3;
                        this.offset += incAmount;
                        shape.uvs[i * 2] = this.getFloat();
                        shape.uvs[(i * 2) + 1] = this.getFloat();
                        break;
                    default:
                        shape.uvs[i * 2] = 0;
                        shape.uvs[(i * 2) + 1] = 0;
                        break;
                }

                if (flags.uniformDiffuse) {
                    shape.colors[i * 4] = diffuse & 0xFF;
                    shape.colors[(i * 4) + 1] = (diffuse >>> 8) & 0xFF;
                    shape.colors[(i * 4) + 2] = (diffuse >>> 16) & 0xFF;
                    shape.colors[(i * 4) + 3] = (diffuse >>> 24) & 0xFF;
                } else {
                    switch (flags.colorFormat) {
                        case ColorFormat.NO_COLOR:
                            shape.colors[i * 4] = 0xFF;
                            shape.colors[(i * 4) + 1] = 0xFF;
                            shape.colors[(i * 4) + 2] = 0xFF;
                            shape.colors[(i * 4) + 3] = 0xFF;
                            break;
                        case ColorFormat.BGR_5650_16BITS:
                            {
                                const c = this.getUshort();
                                // const r = c & 0x1F;
                                // const g = (c >> 5) & 0x3F;
                                // const b = (c >> 11) & 0x1F;
                                shape.colors[i * 4] = 0xFF;//(r << 3) | (r >> 2);
                                shape.colors[(i * 4) + 1] = 0xFF;//(g << 2) | (g >> 4);
                                shape.colors[(i * 4) + 2] = 0xFF;//(b << 3) | (b >> 2);
                                shape.colors[(i * 4) + 3] = 0xFF;//0xFF;
                            }
                            break;
                        case ColorFormat.ABGR_5551_16BITS:
                            {
                                const c = this.getUshort();
                                // const r = c & 0x1F;
                                // const g = (c >> 5) & 0x1F;
                                // const b = (c >> 10) & 0x1F;
                                // const a = (c >> 15) & 1;
                                shape.colors[i * 4] = 0xFF;//(r << 3) | (r >> 2);
                                shape.colors[(i * 4) + 1] = 0xFF;//(g << 3) | (g >> 2);
                                shape.colors[(i * 4) + 2] = 0xFF;//(b << 3) | (b >> 2);
                                shape.colors[(i * 4) + 3] = 0xFF;//a;
                            }
                            break;
                        case ColorFormat.ABGR_4444_16BITS:
                            {
                                const c = this.getUshort();
                                // const r = c & 0x0F;
                                // const g = (c >> 4) & 0x0F;
                                // const b = (c >> 8) & 0x0F;
                                // const a = (c >> 12) & 0x0F;
                                shape.colors[i * 4] = 0xFF;//(r << 4) | r;
                                shape.colors[(i * 4) + 1] = 0xFF;//(g << 4) | g;
                                shape.colors[(i * 4) + 2] = 0xFF;//(b << 4) | b;
                                shape.colors[(i * 4) + 3] = 0xFF;//(a << 4) | a;
                            }
                            break;
                        case ColorFormat.ABGR_8888_32BITS:
                            incAmount = (4 - ((this.offset - ret2) & 3)) & 3;
                            this.offset += incAmount;
                            shape.colors[(i * 4) + 0] = this.getByte();
                            shape.colors[(i * 4) + 1] = this.getByte();
                            shape.colors[(i * 4) + 2] = this.getByte();
                            shape.colors[(i * 4) + 3] = this.getByte();
                            break;
                    }
                }
                shape.colors[i * 4] /= COLOR_SCALE;
                shape.colors[(i * 4) + 1] /= COLOR_SCALE;
                shape.colors[(i * 4) + 2] /= COLOR_SCALE;
                shape.colors[(i * 4) + 3] /= COLOR_SCALE;

                switch (flags.vertexFormat) {
                    case CoordinateFormat.NORMALIZED_8_BITS:
                        shape.vertices[i * 3] = this.getByte() / NORMALIZED_8_SCALE;
                        shape.vertices[(i * 3) + 1] = this.getByte() / NORMALIZED_8_SCALE;
                        shape.vertices[(i * 3) + 2] = this.getByte() / NORMALIZED_8_SCALE;
                        break;
                    case CoordinateFormat.NORMALIZED_16_BITS:
                        incAmount = (2 - ((this.offset - ret2) & 1)) & 1;
                        this.offset += incAmount;
                        shape.vertices[i * 3] = this.getUshort() / NORMALIZED_16_SCALE;
                        shape.vertices[(i * 3) + 1] = this.getUshort() / NORMALIZED_16_SCALE;
                        shape.vertices[(i * 3) + 2] = this.getUshort() / NORMALIZED_16_SCALE;
                        break;
                    case CoordinateFormat.FLOAT_32_BITS:
                        incAmount = (4 - ((this.offset - ret2) & 3)) & 3;
                        this.offset += incAmount;
                        shape.vertices[i * 3] = this.getFloat();
                        shape.vertices[(i * 3) + 1] = this.getFloat();
                        shape.vertices[(i * 3) + 2] = this.getFloat();
                        break;
                    default:
                        console.warn("Unimplemented vertex format", flags.vertexFormat);
                        shape.vertices[i * 3] = 0;
                        shape.vertices[(i * 3) + 1] = 0;
                        shape.vertices[(i * 3) + 2] = 0;
                        break;
                }

                this.offset = ret2 + vertexSizeBytes;
            }

            counter = vertexCount;
            this.offset = ret + (vertexCount * vertexSizeBytes);
            this.offset += this.offset % 4;
            shapes.push(shape);
        }

        return shapes;
    }

    private convertPixelFormat(value: number): BBSPixelFormat {
        switch (value) {
            case 1:
                return BBSPixelFormat.RGBA_1555;
            case 2:
                return BBSPixelFormat.RGB_888;
            case 3:
                return BBSPixelFormat.RGBA_888;
            case 4:
                return BBSPixelFormat.INDEXED_4;
            case 5:
                return BBSPixelFormat.INDEXED_8;
            case 0:
            default:
                return BBSPixelFormat.UNKNOWN;
        }
    }
}