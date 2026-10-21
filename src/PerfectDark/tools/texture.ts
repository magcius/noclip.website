import { inflateRawSync } from "node:zlib";

import { PDT1_VERSION } from "../texture.js";

export interface TextureRomLayout {
    dataOffset: number;
    tableOffset: number;
    tableEnd: number;
}

export interface DecodedTexture {
    id: number;
    width: number;
    height: number;
    pixels: Uint8Array;
}

const formatChannels = [4, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1];
const formatHasAlphaBit = [false, true, false, false, false, false, true, false, false, false, false, false, false];
const formatChannelSizes = [256, 32, 256, 32, 256, 16, 8, 256, 16, 256, 16, 256, 16];
const formatBitsPerPixel = [32, 16, 24, 15, 16, 8, 4, 8, 4, 16, 16, 16, 16];

class BitReader {
    private bitOffset = 0;

    public constructor(private readonly data: Uint8Array) {}

    public read(count: number): number {
        if (count < 0 || count > 32 || this.bitOffset + count > this.data.length * 8)
            throw new Error(`Texture bitstream overrun while reading ${count} bits`);

        let value = 0;
        for (let i = 0; i < count; i++) {
            const offset = this.bitOffset++;
            value = value * 2 + ((this.data[offset >>> 3] >>> (7 - (offset & 7))) & 1);
        }
        return value;
    }
}

function inflateHuffman(reader: BitReader, count: number, channelSize: number): number[] {
    const frequencies = new Array<number>(channelSize);
    const nodes = Array.from({ length: channelSize }, () => [-1, -1]);
    for (let i = 0; i < channelSize; i++)
        frequencies[i] = reader.read(8);

    let minFrequency1 = 9999;
    let minFrequency2 = 9999;
    let minIndex1 = 0;
    let minIndex2 = 0;
    let rootIndex = 0;

    for (let i = 0; i < channelSize; i++) {
        if (frequencies[i] < minFrequency1) {
            if (minFrequency2 < minFrequency1) {
                minFrequency1 = frequencies[i];
                minIndex1 = i;
            } else {
                minFrequency2 = frequencies[i];
                minIndex2 = i;
            }
        } else if (frequencies[i] < minFrequency2) {
            minFrequency2 = frequencies[i];
            minIndex2 = i;
        }
    }

    for (;;) {
        let sum = frequencies[minIndex1] + frequencies[minIndex2];
        if (sum === 0)
            sum = 1;
        frequencies[minIndex1] = 9999;
        frequencies[minIndex2] = 9999;

        if (nodes[minIndex1][0] < 0 && nodes[minIndex1][1] < 0) {
            nodes[minIndex1][0] = minIndex1 + 10000;
            rootIndex = minIndex1;
            frequencies[minIndex1] = sum;
            nodes[minIndex1][1] = nodes[minIndex2][0] < 0 && nodes[minIndex2][1] < 0 ? minIndex2 + 10000 : minIndex2;
        } else if (nodes[minIndex2][0] < 0 && nodes[minIndex2][1] < 0) {
            nodes[minIndex2][0] = minIndex2 + 10000;
            rootIndex = minIndex2;
            frequencies[minIndex2] = sum;
            nodes[minIndex2][1] = nodes[minIndex1][0] < 0 && nodes[minIndex1][1] < 0 ? minIndex1 + 10000 : minIndex1;
        } else {
            rootIndex = 0;
            while (rootIndex < channelSize && (nodes[rootIndex][0] >= 0 || nodes[rootIndex][1] >= 0 || frequencies[rootIndex] < 9999))
                rootIndex++;
            if (rootIndex >= channelSize)
                throw new Error("Perfect Dark texture Huffman tree has no free root node");
            frequencies[rootIndex] = sum;
            nodes[rootIndex][0] = minIndex1;
            nodes[rootIndex][1] = minIndex2;
        }

        minFrequency1 = 9999;
        minFrequency2 = 9999;
        for (let i = 0; i < channelSize; i++) {
            if (frequencies[i] < minFrequency1) {
                if (minFrequency1 > minFrequency2) {
                    minFrequency1 = frequencies[i];
                    minIndex1 = i;
                } else {
                    minFrequency2 = frequencies[i];
                    minIndex2 = i;
                }
            } else if (frequencies[i] < minFrequency2) {
                minFrequency2 = frequencies[i];
                minIndex2 = i;
            }
        }

        if (minFrequency1 === 9999 || minFrequency2 === 9999)
            break;
    }

    const output = new Array<number>(count);
    for (let i = 0; i < count; i++) {
        let indexOrValue = rootIndex;
        while (indexOrValue < 10000) {
            const node = nodes[indexOrValue];
            if (node === undefined || node[0] < 0 || node[1] < 0)
                throw new Error("Perfect Dark texture Huffman tree contains an invalid branch");
            indexOrValue = node[reader.read(1)];
        }
        output[i] = indexOrValue - 10000;
    }
    return output;
}

function inflateRle(reader: BitReader, count: number): number[] {
    const backtrackBits = reader.read(3);
    const runLengthBits = reader.read(3);
    const blockBits = reader.read(4);
    if (blockBits === 0)
        throw new Error("Perfect Dark texture RLE uses a zero-sized block");

    let cost = backtrackBits + runLengthBits + blockBits + 1;
    let fudge = 0;
    while (cost > 0) {
        cost -= blockBits + 1;
        fudge++;
    }

    const output: number[] = [];
    while (output.length < count) {
        if (reader.read(1) === 0) {
            output.push(reader.read(blockBits));
        } else {
            const start = output.length - reader.read(backtrackBits) - 1;
            const runLength = reader.read(runLengthBits) + fudge;
            if (start < 0)
                throw new Error("Perfect Dark texture RLE backtracks before its output");
            for (let i = 0; i < runLength && output.length < count; i++)
                output.push(output[start + i]);
            if (output.length < count)
                output.push(reader.read(blockBits));
        }
    }
    return output;
}

function buildLookup(reader: BitReader, bitsPerPixel: number): number[] {
    const count = reader.read(11);
    if (count <= 0)
        throw new Error("Perfect Dark texture contains an empty lookup table");
    return Array.from({ length: count }, () => reader.read(bitsPerPixel));
}

function getBitSize(value: number): number {
    let count = 0;
    for (value--; value > 0; value >>>= 1)
        count++;
    return count;
}

function blur(values: number[], width: number, height: number, method: number, channelSize: number): void {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            const current = values[index] + channelSize * 2;
            const left = x > 0 ? values[index - 1] : 0;
            const above = y > 0 ? values[index - width] : 0;
            const aboveLeft = x > 0 && y > 0 ? values[index - width - 1] : 0;
            let predictor = 0;
            if (method === 0)
                predictor = left;
            else if (method === 1)
                predictor = above;
            else if (method === 2)
                predictor = aboveLeft;
            else if (method === 3)
                predictor = left + above - aboveLeft;
            else if (method === 4)
                predictor = Math.trunc((above - aboveLeft) / 2) + left;
            else if (method === 5)
                predictor = Math.trunc((left - aboveLeft) / 2) + above;
            else if (method === 6)
                predictor = Math.trunc((left + above) / 2);
            else
                throw new Error(`Unsupported Perfect Dark texture blur method ${method}`);
            values[index] = (current + predictor) % channelSize;
        }
    }
}

function scale(value: number, maximum: number): number {
    return Math.round(value * 255 / maximum);
}

function writeRgbaFromValue(output: Uint8Array, pixel: number, format: number, value: number): void {
    const offset = pixel * 4;
    if (format === 0) {
        output[offset + 0] = Math.floor(value / 0x1000000) & 0xff;
        output[offset + 1] = Math.floor(value / 0x10000) & 0xff;
        output[offset + 2] = Math.floor(value / 0x100) & 0xff;
        output[offset + 3] = value & 0xff;
    } else if (format === 1 || format === 3 || format === 9 || format === 10) {
        output[offset + 0] = scale((value >>> 11) & 0x1f, 0x1f);
        output[offset + 1] = scale((value >>> 6) & 0x1f, 0x1f);
        output[offset + 2] = scale((value >>> 1) & 0x1f, 0x1f);
        output[offset + 3] = format === 3 ? 0xff : (value & 1 ? 0xff : 0);
    } else if (format === 2) {
        output[offset + 0] = (value >>> 16) & 0xff;
        output[offset + 1] = (value >>> 8) & 0xff;
        output[offset + 2] = value & 0xff;
        output[offset + 3] = 0xff;
    } else if (format === 4 || format === 11 || format === 12) {
        output[offset + 0] = output[offset + 1] = output[offset + 2] = (value >>> 8) & 0xff;
        output[offset + 3] = value & 0xff;
    } else if (format === 5) {
        output[offset + 0] = output[offset + 1] = output[offset + 2] = scale((value >>> 4) & 0x0f, 0x0f);
        output[offset + 3] = scale(value & 0x0f, 0x0f);
    } else if (format === 6) {
        output[offset + 0] = output[offset + 1] = output[offset + 2] = scale((value >>> 1) & 0x07, 0x07);
        output[offset + 3] = value & 1 ? 0xff : 0;
    } else if (format === 7) {
        output[offset + 0] = output[offset + 1] = output[offset + 2] = value & 0xff;
        output[offset + 3] = 0xff;
    } else if (format === 8) {
        output[offset + 0] = output[offset + 1] = output[offset + 2] = scale(value & 0x0f, 0x0f);
        output[offset + 3] = 0xff;
    } else {
        throw new Error(`Unsupported Perfect Dark texture format ${format}`);
    }
}

function channelsToRgba(values: number[], width: number, height: number, format: number): Uint8Array {
    const count = width * height;
    const output = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        const offset = i * 4;
        if (format === 0) {
            output[offset + 0] = values[i];
            output[offset + 1] = values[i + count];
            output[offset + 2] = values[i + count * 2];
            output[offset + 3] = values[i + count * 3];
        } else if (format === 1) {
            output[offset + 0] = scale(values[i], 0x1f);
            output[offset + 1] = scale(values[i + count], 0x1f);
            output[offset + 2] = scale(values[i + count * 2], 0x1f);
            output[offset + 3] = values[i + count * 3] ? 0xff : 0;
        } else if (format === 2 || format === 3) {
            const maximum = format === 2 ? 0xff : 0x1f;
            output[offset + 0] = scale(values[i], maximum);
            output[offset + 1] = scale(values[i + count], maximum);
            output[offset + 2] = scale(values[i + count * 2], maximum);
            output[offset + 3] = 0xff;
        } else if (format === 4) {
            output[offset + 0] = output[offset + 1] = output[offset + 2] = values[i];
            output[offset + 3] = values[i + count];
        } else if (format === 5) {
            output[offset + 0] = output[offset + 1] = output[offset + 2] = scale(values[i], 0x0f);
            output[offset + 3] = scale(values[i + count], 0x0f);
        } else if (format === 6) {
            output[offset + 0] = output[offset + 1] = output[offset + 2] = scale(values[i], 0x07);
            output[offset + 3] = values[i + count * 3] ? 0xff : 0;
        } else if (format === 7) {
            output[offset + 0] = output[offset + 1] = output[offset + 2] = values[i];
            output[offset + 3] = 0xff;
        } else if (format === 8) {
            output[offset + 0] = output[offset + 1] = output[offset + 2] = scale(values[i], 0x0f);
            output[offset + 3] = 0xff;
        } else {
            throw new Error(`Unsupported Perfect Dark channel texture format ${format}`);
        }
    }
    return output;
}

function decodeNonZlib(data: Uint8Array): Omit<DecodedTexture, "id"> {
    const reader = new BitReader(data);
    const format = reader.read(4);
    const width = reader.read(8);
    const height = reader.read(8);
    const method = reader.read(4);
    if (format >= formatChannels.length || width === 0 || height === 0 || width * height > 0x2000)
        throw new Error(`Invalid Perfect Dark texture header ${format}:${width}x${height}`);

    const pixelCount = width * height;
    let pixels: Uint8Array;
    if (method === 0 || method === 1) {
        pixels = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++)
            writeRgbaFromValue(pixels, i, format, reader.read(formatBitsPerPixel[format]));
    } else if (method === 2 || method === 4 || method === 8) {
        const blurMethod = method === 8 ? reader.read(3) : -1;
        let values = method === 4
            ? inflateRle(reader, formatChannels[format] * pixelCount)
            : inflateHuffman(reader, formatChannels[format] * pixelCount, formatChannelSizes[format]);
        if (method === 8)
            blur(values, width, formatChannels[format] * height, blurMethod, formatChannelSizes[format]);
        if (formatHasAlphaBit[format]) {
            const alphaOffset = pixelCount * 3;
            while (values.length < alphaOffset)
                values.push(0);
            for (let i = 0; i < pixelCount; i++)
                values[alphaOffset + i] = reader.read(1);
        }
        pixels = channelsToRgba(values, width, height, format);
    } else if (method === 5 || method === 6 || method === 7) {
        const lookup = buildLookup(reader, formatBitsPerPixel[format]);
        let indices: number[];
        if (method === 5) {
            const bitSize = getBitSize(lookup.length);
            indices = Array.from({ length: pixelCount }, () => reader.read(bitSize));
        } else if (method === 6) {
            indices = inflateHuffman(reader, pixelCount, lookup.length);
        } else {
            indices = inflateRle(reader, pixelCount);
        }
        pixels = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const value = lookup[indices[i]];
            if (value === undefined)
                throw new Error(`Perfect Dark texture lookup index ${indices[i]} exceeds ${lookup.length} colors`);
            writeRgbaFromValue(pixels, i, format, value);
        }
    } else {
        throw new Error(`Unsupported Perfect Dark texture compression method ${method}`);
    }
    return { width, height, pixels };
}

function decodeZlib(data: Uint8Array): Omit<DecodedTexture, "id"> {
    const reader = new BitReader(data);
    const format = reader.read(8);
    const paletteCount = reader.read(8) + 1;
    const palette = Array.from({ length: paletteCount }, () => reader.read(16));
    const width = reader.read(8);
    const height = reader.read(8);
    if (format < 9 || format > 12 || width === 0 || height === 0)
        throw new Error(`Invalid Perfect Dark paletted texture header ${format}:${width}x${height}`);

    const byteOffset = 4 + paletteCount * 2;
    if (data[byteOffset] !== 0x11 || data[byteOffset + 1] !== 0x73)
        throw new Error("Perfect Dark paletted texture has no RareZip image");
    const expected = (data[byteOffset + 2] << 16) | (data[byteOffset + 3] << 8) | data[byteOffset + 4];
    const indices = inflateRawSync(data.subarray(byteOffset + 5));
    if (indices.length !== expected)
        throw new Error(`Perfect Dark paletted texture inflated to ${indices.length} bytes; expected ${expected}`);

    const pixelCount = width * height;
    const pixels = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const paletteIndex = format === 9 || format === 11
            ? indices[i]
            : ((indices[i >>> 1] >>> (i & 1 ? 0 : 4)) & 0x0f);
        const value = palette[paletteIndex];
        if (value === undefined)
            throw new Error(`Perfect Dark texture palette index ${paletteIndex} exceeds ${palette.length} colors`);
        writeRgbaFromValue(pixels, i, format, value);
    }
    return { width, height, pixels };
}

export function decodeTexture(rom: Uint8Array, layout: TextureRomLayout, id: number): DecodedTexture {
    const tableSize = layout.tableEnd - layout.tableOffset;
    const textureCount = Math.floor(tableSize / 8) - 1;
    if (id < 0 || id >= textureCount)
        throw new Error(`Perfect Dark texture ${id} is outside the ${textureCount}-entry table`);

    const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const start = view.getUint32(layout.tableOffset + id * 8, false) & 0x00ffffff;
    const end = view.getUint32(layout.tableOffset + (id + 1) * 8, false) & 0x00ffffff;
    if (start >= end || layout.dataOffset + end > rom.byteLength)
        throw new Error(`Perfect Dark texture ${id} has an invalid data range`);
    const data = rom.subarray(layout.dataOffset + start, layout.dataOffset + end);
    const header = data[0];
    const decoded = header & 0x40 ? decodeZlib(data.subarray(1)) : decodeNonZlib(data.subarray(1));
    return { id, ...decoded };
}

export function buildTextureBank(textures: DecodedTexture[]): Buffer {
    const sorted = [...textures].sort((a, b) => a.id - b.id);
    const headerSize = 0x10;
    const entrySize = 0x10;
    let pixelOffset = headerSize + sorted.length * entrySize;
    const size = pixelOffset + sorted.reduce((sum, texture) => sum + texture.pixels.length, 0);
    const output = Buffer.alloc(size);
    output.write("PDT1", 0x00, "ascii");
    output.writeUInt32LE(PDT1_VERSION, 0x04);
    output.writeUInt32LE(sorted.length, 0x08);
    output.writeUInt32LE(headerSize, 0x0c);

    for (let i = 0; i < sorted.length; i++) {
        const texture = sorted[i];
        const entryOffset = headerSize + i * entrySize;
        output.writeUInt16LE(texture.id, entryOffset + 0x00);
        output.writeUInt16LE(texture.width, entryOffset + 0x02);
        output.writeUInt16LE(texture.height, entryOffset + 0x04);
        output.writeUInt32LE(pixelOffset, entryOffset + 0x08);
        output.writeUInt32LE(texture.pixels.length, entryOffset + 0x0c);
        output.set(texture.pixels, pixelOffset);
        pixelOffset += texture.pixels.length;
    }
    return output;
}
