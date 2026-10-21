import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { mat3, mat4, quat, vec3 } from "gl-matrix";

import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { combinePerfectDarkLevels, parsePerfectDarkLevel, PDB1_VERSION } from "../data.js";
import { parsePerfectDarkManifest, PERFECT_DARK_DATASET_VERSION, PERFECT_DARK_MANIFEST_VERSION, PerfectDarkManifest } from "../manifest.js";
import { PDT1_VERSION } from "../texture.js";
import { buildTextureBank, decodeTexture, TextureRomLayout } from "./texture.js";

const ROM_SIZE = 32 * 1024 * 1024;
const BG_ADDRESS_BASE = 0x0f000000;
const FIRST_BG_FILE_ID = 0x01;
const LAST_BG_FILE_ID = 0x3c;
const PDB1_HEADER_SIZE = 0x20;
const PDB1_VERTEX_STRIDE = 0x18;
const PDB1_BATCH_STRIDE = 0x10;
const BATCH_FLAG_TRANSLUCENT = 1 << 0;
const BATCH_FLAG_SECONDARY_TEXTURE = 1 << 15;

interface RomVersion {
    name: string;
    md5: string;
    fileTableOffset: number;
    modelCount: number;
    animationDataOffset: number;
    animationTableOffset: number;
    textureLayout: TextureRomLayout;
}

interface AnimationJointPose {
    rotation: [number, number, number];
    translation: [number, number, number];
    scale: [number, number, number];
}

type AnimationPose = AnimationJointPose[];

interface BgRoom {
    gfxDataAddress: number;
    position: [number, number, number];
}

interface RoomBlock {
    address: number;
    type: number;
    nextAddress: number;
    dataAddress: number;
    verticesAddress: number;
    colorsAddress: number;
}

interface OutputVertex {
    x: number;
    y: number;
    z: number;
    s: number;
    t: number;
    r: number;
    g: number;
    b: number;
    a: number;
}

interface OutputBatch {
    textureId: number;
    secondaryTextureId: number;
    flags: number;
    indices: number[];
}

interface FloorTriangle {
    a: [number, number, number];
    b: [number, number, number];
    c: [number, number, number];
}

interface RoomBounds {
    min: [number, number, number];
    max: [number, number, number];
}

interface ConvertedBackground {
    data: Buffer;
    textureIds: Set<number>;
    textureSubcommands: Set<number>;
    floorTrianglesByRoom: Map<number, FloorTriangle[]>;
    roomBoundsByRoom: Map<number, RoomBounds>;
}

interface ModelGeometry {
    vertices: OutputVertex[];
    batches: OutputBatch[];
    skeletonId: number;
    bbox: [number, number, number, number, number, number] | null;
    rootPosition: [number, number, number];
    originOffset: [number, number, number];
    matrixCount: number;
    partTransforms: Map<number, mat4>;
    textureIds: Set<number>;
    textureSubcommands: Set<number>;
}

interface PadData {
    position: [number, number, number];
    look: [number, number, number];
    up: [number, number, number];
    normal: [number, number, number];
    bbox: [number, number, number, number, number, number];
    hasBbox: boolean;
    room: number;
    flags: number;
}

interface StageTableEntry {
    bgFileId: number;
    tileFileId: number;
    padsFileId: number;
    setupFileId: number;
    multiplayerSetupFileId: number;
}

interface StageExtraction {
    id: string;
    stageIndex: number;
    multiplayer?: boolean;
    titleSequence?: boolean;
    characterGallery?: boolean;
    objectGallery?: ObjectGalleryKind;
}

type ObjectGalleryKind = "props" | "doors" | "items";

interface ObjectGalleryEntry {
    type: number;
    modelNum: number;
    extraScale: number;
    doorFlags: number;
    doorType: number;
}

type ObjectGalleryCatalog = Record<ObjectGalleryKind, ObjectGalleryEntry[]>;

interface HeadBodyState {
    fileId: number;
    scale: number;
    animationScale: number;
    isMale: boolean;
    hasEmbeddedHead: boolean;
}

function readUint32BE(data: Uint8Array, offs: number): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offs, false);
}

function normalizeRom(input: Buffer): Uint8Array {
    if (input.byteLength !== ROM_SIZE)
        throw new Error(`Expected a 32 MiB Perfect Dark ROM, got ${input.byteLength} bytes`);

    const rom = Uint8Array.from(input);
    const magic = readUint32BE(rom, 0);
    if (magic === 0x80371240)
        return rom;

    if (magic === 0x37804012) {
        for (let i = 0; i < rom.length; i += 2)
            [rom[i], rom[i + 1]] = [rom[i + 1], rom[i]];
    } else if (magic === 0x40123780) {
        for (let i = 0; i < rom.length; i += 4) {
            [rom[i], rom[i + 3]] = [rom[i + 3], rom[i]];
            [rom[i + 1], rom[i + 2]] = [rom[i + 2], rom[i + 1]];
        }
    } else {
        throw new Error(`Unsupported N64 ROM byte order (magic 0x${magic.toString(16).padStart(8, "0")})`);
    }

    if (readUint32BE(rom, 0) !== 0x80371240)
        throw new Error("Failed to normalize the N64 ROM byte order");
    return rom;
}

function identifyRomVersion(rom: Uint8Array): RomVersion {
    const gameCode = Buffer.from(rom.subarray(0x3b, 0x3f)).toString("ascii");
    const version = rom[0x3f];

    if (gameCode === "NPDE" && version === 0)
        return { name: "NTSC 1.0", md5: "7f4171b0c8d17815be37913f535e4e93", fileTableOffset: 0x28080, modelCount: 0x1b9, animationDataOffset: 0x1a15c0, animationTableOffset: 0x7cd1a0, textureLayout: { dataOffset: 0x1d65f40, tableOffset: 0x1ff7ca0, tableEnd: 0x1ffea20 } };
    if (gameCode === "NPDE" && version === 1)
        return { name: "NTSC final", md5: "e03b088b6ac9e0080440efed07c1e40f", fileTableOffset: 0x28080, modelCount: 0x1b9, animationDataOffset: 0x1a15c0, animationTableOffset: 0x7cd1a0, textureLayout: { dataOffset: 0x1d65f40, tableOffset: 0x1ff7ca0, tableEnd: 0x1ffea20 } };
    if (gameCode === "NPDP" && rom[0x100f] === 0xf0)
        return { name: "PAL final", md5: "d9b5cd305d228424891ce38e71bc9213", fileTableOffset: 0x28910, modelCount: 0x1b9, animationDataOffset: 0x18cdc0, animationTableOffset: 0x7b89a0, textureLayout: { dataOffset: 0x1d5ca20, tableOffset: 0x1fee780, tableEnd: 0x1ff5500 } };
    if (gameCode === "NPDJ")
        return { name: "Japanese final", md5: "538d2b75945eae069b29c46193e74790", fileTableOffset: 0x28800, modelCount: 0x1bb, animationDataOffset: 0x190c50, animationTableOffset: 0x7bc830, textureLayout: { dataOffset: 0x1d61f90, tableOffset: 0x1ff68f0, tableEnd: 0x1ffd6b0 } };

    if (gameCode === "NPDP" || Buffer.from(rom.subarray(0x20, 0x34)).toString("ascii") === "Perfect Dark DBGNTSC")
        throw new Error("Perfect Dark beta ROMs are not supported");
    throw new Error(`Unrecognized Perfect Dark ROM (${gameCode}, revision ${version})`);
}

function inflateRareZip(data: Uint8Array, context: string): Uint8Array {
    if (data.length < 5 || data[0] !== 0x11 || data[1] !== 0x73)
        throw new Error(`${context} does not start with a RareZip 1173 header`);

    const expectedSize = (data[2] << 16) | (data[3] << 8) | data[4];
    const inflated = inflateRawSync(data.subarray(5));
    if (inflated.byteLength !== expectedSize)
        throw new Error(`${context} inflated to ${inflated.byteLength} bytes; expected ${expectedSize}`);
    return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

function inflateBgChunk(data: Uint8Array, context: string): Uint8Array {
    if (data.length >= 2 && data[0] === 0x11 && data[1] === 0x73)
        return inflateRareZip(data, context);
    return data;
}

class GeometryBuilder {
    public readonly vertices: OutputVertex[] = [];
    public readonly textureIds = new Set<number>();
    public readonly textureSubcommands = new Set<number>();
    private readonly batches = new Map<string, OutputBatch>();

    public addVertex(vertex: OutputVertex): number {
        this.vertices.push(vertex);
        return this.vertices.length - 1;
    }

    public addTriangle(textureId: number, secondaryTextureId: number, flags: number, i0: number, i1: number, i2: number): void {
        const key = `${flags}:${textureId}:${secondaryTextureId}`;
        let batch = this.batches.get(key);
        if (batch === undefined) {
            batch = { textureId, secondaryTextureId, flags, indices: [] };
            this.batches.set(key, batch);
        }
        batch.indices.push(i0, i1, i2);
        if (textureId !== 0xffff)
            this.textureIds.add(textureId);
        if (secondaryTextureId !== 0xffff)
            this.textureIds.add(secondaryTextureId);
    }

    public appendModel(model: ModelGeometry, transform: mat4): void {
        const firstVertex = this.vertices.length;
        const transformed = vec3.create();

        for (const vertex of model.vertices) {
            vec3.transformMat4(transformed, [vertex.x, vertex.y, vertex.z], transform);
            this.addVertex({ ...vertex, x: transformed[0], y: transformed[1], z: transformed[2] });
        }

        for (const batch of model.batches) {
            for (let i = 0; i < batch.indices.length; i += 3) {
                this.addTriangle(batch.textureId, batch.secondaryTextureId, batch.flags,
                    firstVertex + batch.indices[i], firstVertex + batch.indices[i + 1], firstVertex + batch.indices[i + 2]);
            }
        }
    }

    public get vertexCount(): number {
        return this.vertices.length;
    }

    public build(): Buffer {
        const batches = [...this.batches.values()].filter((batch) => batch.indices.length > 0);
        const indexCount = batches.reduce((sum, batch) => sum + batch.indices.length, 0);
        const vertexOffset = PDB1_HEADER_SIZE;
        const indexOffset = vertexOffset + this.vertices.length * PDB1_VERTEX_STRIDE;
        const batchOffset = indexOffset + indexCount * 4;
        const output = Buffer.alloc(batchOffset + batches.length * PDB1_BATCH_STRIDE);

        output.write("PDB1", 0x00, "ascii");
        output.writeUInt32LE(PDB1_VERSION, 0x04);
        output.writeUInt32LE(this.vertices.length, 0x08);
        output.writeUInt32LE(indexCount, 0x0c);
        output.writeUInt32LE(batches.length, 0x10);
        output.writeUInt32LE(vertexOffset, 0x14);
        output.writeUInt32LE(indexOffset, 0x18);
        output.writeUInt32LE(batchOffset, 0x1c);

        for (let i = 0; i < this.vertices.length; i++) {
            const vertex = this.vertices[i];
            const offs = vertexOffset + i * PDB1_VERTEX_STRIDE;
            output.writeFloatLE(vertex.x, offs + 0x00);
            output.writeFloatLE(vertex.y, offs + 0x04);
            output.writeFloatLE(vertex.z, offs + 0x08);
            output.writeFloatLE(vertex.s, offs + 0x0c);
            output.writeFloatLE(vertex.t, offs + 0x10);
            output[offs + 0x14] = vertex.r;
            output[offs + 0x15] = vertex.g;
            output[offs + 0x16] = vertex.b;
            output[offs + 0x17] = vertex.a;
        }

        let firstIndex = 0;
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            for (let j = 0; j < batch.indices.length; j++)
                output.writeUInt32LE(batch.indices[j], indexOffset + (firstIndex + j) * 4);

            const offs = batchOffset + i * PDB1_BATCH_STRIDE;
            output.writeUInt32LE(firstIndex, offs + 0x00);
            output.writeUInt32LE(batch.indices.length, offs + 0x04);
            output.writeUInt16LE(batch.textureId, offs + 0x08);
            output.writeUInt16LE(batch.flags, offs + 0x0a);
            output.writeUInt16LE(batch.secondaryTextureId, offs + 0x0c);
            firstIndex += batch.indices.length;
        }

        return output;
    }
}

function readColor(room: Uint8Array, colorOffset: number, lit: boolean): [number, number, number, number] {
    if (colorOffset < 0 || colorOffset + 4 > room.byteLength)
        return [0xff, 0xff, 0xff, 0xff];

    const r = room[colorOffset + 0];
    const g = room[colorOffset + 1];
    const b = room[colorOffset + 2];
    const a = room[colorOffset + 3];
    if (!lit)
        return [r, g, b, a];

    const nx = (r << 24) >> 24;
    const ny = (g << 24) >> 24;
    const nz = (b << 24) >> 24;
    const length = Math.hypot(nx, ny, nz) || 1;
    const dot = Math.max(0, (nx * 0.28 + ny * 0.88 + nz * 0.38) / length);
    const shade = Math.round(255 * (0.35 + 0.65 * dot));
    return [shade, shade, shade, a];
}

function parseDisplayList(
    builder: GeometryBuilder,
    room: Uint8Array,
    roomBaseAddress: number,
    roomPosition: [number, number, number],
    block: RoomBlock,
    translucent: boolean,
    floorTriangles: FloorTriangle[],
    bounds: RoomBounds,
): void {
    const view = new DataView(room.buffer, room.byteOffset, room.byteLength);
    const vertexCache = new Int32Array(64).fill(-1);
    const visited = new Set<number>();
    let textureId = 0xffff;
    let secondaryTextureId = 0xffff;
    let materialFlags = translucent ? BATCH_FLAG_TRANSLUCENT : 0;
    let geometryMode = 0x00000004;
    let colorPointer = block.colorsAddress - roomBaseAddress;

    const emitTriangle = (i0: number, i1: number, i2: number): void => {
        if (i0 === i1 && i1 === i2)
            return;
        const v0 = vertexCache[i0];
        const v1 = vertexCache[i1];
        const v2 = vertexCache[i2];
        if (v0 < 0 || v1 < 0 || v2 < 0)
            return;
        builder.addTriangle(textureId, secondaryTextureId, materialFlags, v0, v1, v2);

        if (!translucent) {
            const a = builder.vertices[v0];
            const b = builder.vertices[v1];
            const c = builder.vertices[v2];
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const acx = c.x - a.x;
            const acy = c.y - a.y;
            const acz = c.z - a.z;
            const nx = aby * acz - abz * acy;
            const ny = abz * acx - abx * acz;
            const nz = abx * acy - aby * acx;
            if (Math.abs(ny) > Math.hypot(nx, nz) * 0.25) {
                floorTriangles.push({
                    a: [a.x, a.y, a.z],
                    b: [b.x, b.y, b.z],
                    c: [c.x, c.y, c.z],
                });
            }
        }
    };

    const run = (startAddress: number, depth: number): void => {
        if (depth > 16)
            throw new Error("Perfect Dark display-list recursion exceeded 16 levels");
        let offs = startAddress - roomBaseAddress;

        for (let commandIndex = 0; commandIndex < 0x10000; commandIndex++, offs += 8) {
            if (offs < 0 || offs + 8 > room.byteLength)
                throw new Error(`Display list points outside its room at 0x${offs.toString(16)}`);
            if (visited.has(offs))
                return;
            visited.add(offs);

            const w0 = view.getUint32(offs + 0x00, false);
            const w1 = view.getUint32(offs + 0x04, false);
            const opcode = w0 >>> 24;

            switch (opcode) {
            case 0x04: {
                const count = (w0 & 0xffff) / 12;
                const destination = (w0 >>> 16) & 0x0f;
                const vertexOffset = block.verticesAddress - roomBaseAddress + (w1 & 0x00ffffff);
                for (let i = 0; i < count && destination + i < vertexCache.length; i++) {
                    const vertexOffs = vertexOffset + i * 12;
                    if (vertexOffs < 0 || vertexOffs + 12 > room.byteLength)
                        break;
                    const colorIndex = room[vertexOffs + 0x07] & 0xfc;
                    const [r, g, b, a] = readColor(room, colorPointer + colorIndex, (geometryMode & 0x00020000) !== 0);
                    const x = view.getInt16(vertexOffs + 0x00, false) + roomPosition[0];
                    const y = view.getInt16(vertexOffs + 0x02, false) + roomPosition[1];
                    const z = view.getInt16(vertexOffs + 0x04, false) + roomPosition[2];
                    bounds.min[0] = Math.min(bounds.min[0], x);
                    bounds.min[1] = Math.min(bounds.min[1], y);
                    bounds.min[2] = Math.min(bounds.min[2], z);
                    bounds.max[0] = Math.max(bounds.max[0], x);
                    bounds.max[1] = Math.max(bounds.max[1], y);
                    bounds.max[2] = Math.max(bounds.max[2], z);
                    vertexCache[destination + i] = builder.addVertex({
                        x, y, z,
                        s: view.getInt16(vertexOffs + 0x08, false),
                        t: view.getInt16(vertexOffs + 0x0a, false),
                        r, g, b, a,
                    });
                }
                break;
            }
            case 0x06:
                run(BG_ADDRESS_BASE + (w1 & 0x00ffffff), depth + 1);
                if (((w0 >>> 16) & 1) !== 0)
                    return;
                break;
            case 0x07:
                colorPointer = block.colorsAddress - roomBaseAddress + (w1 & 0x00ffffff);
                break;
            case 0xb1: {
                const triangles = [
                    [w1 & 0x0f, (w1 >>> 4) & 0x0f, w0 & 0x0f],
                    [(w1 >>> 8) & 0x0f, (w1 >>> 12) & 0x0f, (w0 >>> 4) & 0x0f],
                    [(w1 >>> 16) & 0x0f, (w1 >>> 20) & 0x0f, (w0 >>> 8) & 0x0f],
                    [(w1 >>> 24) & 0x0f, (w1 >>> 28) & 0x0f, (w0 >>> 12) & 0x0f],
                ];
                for (const [i0, i1, i2] of triangles)
                    emitTriangle(i0, i1, i2);
                break;
            }
            case 0xb6:
                geometryMode &= ~w1;
                break;
            case 0xb7:
                geometryMode |= w1;
                break;
            case 0xb8:
                return;
            case 0xbf:
                emitTriangle(Math.floor(((w1 >>> 16) & 0xff) / 10), Math.floor(((w1 >>> 8) & 0xff) / 10), Math.floor((w1 & 0xff) / 10));
                break;
            case 0xc0:
                textureId = w1 & 0x0fff;
                const textureSubcommand = w0 & 0x07;
                secondaryTextureId = textureSubcommand === 1 ? (w1 >>> 12) & 0x0fff : 0xffff;
                builder.textureSubcommands.add(textureSubcommand);
                materialFlags = (translucent ? BATCH_FLAG_TRANSLUCENT : 0)
                    | (((w0 >>> 22) & 0x03) << 1)
                    | (((w0 >>> 20) & 0x03) << 3)
                    | (((w0 >>> 14) & 0x0f) << 5)
                    | (((w0 >>> 10) & 0x0f) << 9)
                    | (secondaryTextureId !== 0xffff ? BATCH_FLAG_SECONDARY_TEXTURE : 0);
                break;
            }
        }

        throw new Error("Perfect Dark display list did not terminate");
    };

    run(block.dataAddress, 0);
}

function parseRoom(
    builder: GeometryBuilder,
    compressed: Uint8Array,
    roomBaseAddress: number,
    roomPosition: [number, number, number],
    roomNumber: number,
    floorTriangles: FloorTriangle[],
    bounds: RoomBounds,
): void {
    const room = inflateBgChunk(compressed, `room ${roomNumber}`);
    if (room.byteLength < 0x18)
        return;
    const view = new DataView(room.buffer, room.byteOffset, room.byteLength);
    const verticesAddress = view.getUint32(0x00, false);
    const opaqueRootAddress = view.getUint32(0x08, false);
    const translucentRootAddress = view.getUint32(0x0c, false);
    let endOffset = verticesAddress - roomBaseAddress;
    if (endOffset <= 0x18 || endOffset > room.byteLength)
        return;

    const blocks = new Map<number, RoomBlock>();
    for (let offs = 0x18; offs + 0x14 <= endOffset; offs += 0x14) {
        const type = room[offs];
        if (type !== 0 && type !== 1)
            break;
        const block: RoomBlock = {
            address: roomBaseAddress + offs,
            type,
            nextAddress: view.getUint32(offs + 0x04, false),
            dataAddress: view.getUint32(offs + 0x08, false),
            verticesAddress: view.getUint32(offs + 0x0c, false),
            colorsAddress: view.getUint32(offs + 0x10, false),
        };
        blocks.set(block.address, block);

        if (type === 1) {
            const coordinateOffset = block.verticesAddress - roomBaseAddress;
            if (coordinateOffset >= 0x18 && coordinateOffset < endOffset)
                endOffset = coordinateOffset;
        }
    }

    const visited = new Set<string>();
    const visit = (address: number, translucent: boolean): void => {
        if (address === 0)
            return;
        const key = `${address}:${translucent}`;
        if (visited.has(key))
            return;
        visited.add(key);

        const block = blocks.get(address);
        if (block === undefined)
            return;
        if (block.type === 0 && block.dataAddress !== 0)
            parseDisplayList(builder, room, roomBaseAddress, roomPosition, block, translucent, floorTriangles, bounds);
        else if (block.type === 1)
            visit(block.dataAddress, translucent);
        visit(block.nextAddress, translucent);
    };

    visit(opaqueRootAddress, false);
    visit(translucentRootAddress, true);
}

function convertBackground(bgFile: Uint8Array, fileId: number): ConvertedBackground {
    if (bgFile.byteLength < 12)
        throw new Error("BG file is smaller than its header");
    const view = new DataView(bgFile.buffer, bgFile.byteOffset, bgFile.byteLength);
    const primaryInflatedSize = view.getUint32(0x00, false);
    const primaryCompressedSize = view.getUint32(0x08, false);
    const primary = inflateRareZip(bgFile.subarray(0x0c, 0x0c + primaryCompressedSize), `BG 0x${fileId.toString(16)} primary section`);
    if (primary.byteLength !== primaryInflatedSize)
        throw new Error(`BG primary section has size ${primary.byteLength}, expected ${primaryInflatedSize}`);

    const primaryView = new DataView(primary.buffer, primary.byteOffset, primary.byteLength);
    const roomTableOffset = primaryView.getUint32(0x04, false) - BG_ADDRESS_BASE;
    if (roomTableOffset < 0 || roomTableOffset + 0x28 > primary.byteLength)
        throw new Error("BG room table points outside the primary section");

    const rooms: BgRoom[] = [];
    for (let i = 0; i < 0x400; i++) {
        const offs = roomTableOffset + i * 0x14;
        if (offs + 0x14 > primary.byteLength)
            throw new Error("BG room table has no terminator");
        const gfxDataAddress = primaryView.getUint32(offs + 0x00, false);
        rooms.push({
            gfxDataAddress,
            position: [
                primaryView.getFloat32(offs + 0x04, false),
                primaryView.getFloat32(offs + 0x08, false),
                primaryView.getFloat32(offs + 0x0c, false),
            ],
        });
        if (i > 0 && gfxDataAddress === 0)
            break;
    }

    const builder = new GeometryBuilder();
    const floorTrianglesByRoom = new Map<number, FloorTriangle[]>();
    const roomBoundsByRoom = new Map<number, RoomBounds>();
    const primaryDifference = primaryInflatedSize - primaryCompressedSize - 12;
    for (let i = 1; i + 1 < rooms.length; i++) {
        const room = rooms[i];
        const next = rooms[i + 1];
        if (room.gfxDataAddress === 0 || next.gfxDataAddress === 0)
            break;
        const fileOffset = room.gfxDataAddress - BG_ADDRESS_BASE - primaryDifference;
        const compressedSize = next.gfxDataAddress - room.gfxDataAddress;
        if (fileOffset < 0 || compressedSize <= 0 || fileOffset + compressedSize > bgFile.byteLength)
            throw new Error(`Room ${i} points outside BG file 0x${fileId.toString(16)}`);
        const floorTriangles: FloorTriangle[] = [];
        const bounds: RoomBounds = {
            min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
            max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        };
        parseRoom(builder, bgFile.subarray(fileOffset, fileOffset + compressedSize), room.gfxDataAddress, room.position, i, floorTriangles, bounds);
        floorTrianglesByRoom.set(i, floorTriangles);
        if (Number.isFinite(bounds.min[0]))
            roomBoundsByRoom.set(i, bounds);
    }

    if (builder.vertices.length === 0)
        throw new Error(`BG file 0x${fileId.toString(16)} produced no vertices`);
    return { data: builder.build(), textureIds: builder.textureIds, textureSubcommands: builder.textureSubcommands, floorTrianglesByRoom, roomBoundsByRoom };
}

const stageExtractions: StageExtraction[] = [
    { id: "defection", stageIndex: 0x1c },
    { id: "investigation", stageIndex: 0x1f },
    { id: "extraction", stageIndex: 0x0e },
    { id: "villa", stageIndex: 0x18 },
    { id: "chicago", stageIndex: 0x09 },
    { id: "g5-building", stageIndex: 0x0a },
    { id: "infiltration", stageIndex: 0x1b },
    { id: "rescue", stageIndex: 0x21 },
    { id: "escape", stageIndex: 0x05 },
    { id: "air-base", stageIndex: 0x13 },
    { id: "air-force-one", stageIndex: 0x1d },
    { id: "crash-site", stageIndex: 0x08 },
    { id: "pelagic-ii", stageIndex: 0x0d },
    { id: "deep-sea", stageIndex: 0x24 },
    { id: "ci-defense", stageIndex: 0x19 },
    { id: "attack-ship", stageIndex: 0x20 },
    { id: "skedar-ruins", stageIndex: 0x16 },
    { id: "mr-blonde", stageIndex: 0x23 },
    { id: "maian-sos", stageIndex: 0x00 },
    { id: "war", stageIndex: 0x02 },
    { id: "duel", stageIndex: 0x27 },
    { id: "carrington-institute", stageIndex: 0x12 },
    { id: "mp-skedar", stageIndex: 0x1e, multiplayer: true },
    { id: "mp-area-52", stageIndex: 0x2b, multiplayer: true },
    { id: "mp-base", stageIndex: 0x29, multiplayer: true },
    { id: "mp-complex", stageIndex: 0x0b, multiplayer: true },
    { id: "mp-villa", stageIndex: 0x35, multiplayer: true },
    { id: "mp-grid", stageIndex: 0x37, multiplayer: true },
    { id: "mp-ravine", stageIndex: 0x03, multiplayer: true },
    { id: "mp-temple", stageIndex: 0x11, multiplayer: true },
    { id: "mp-g5-building", stageIndex: 0x0c, multiplayer: true },
    { id: "mp-pipes", stageIndex: 0x15, multiplayer: true },
    { id: "mp-felicity", stageIndex: 0x33, multiplayer: true },
    { id: "mp-fortress", stageIndex: 0x34, multiplayer: true },
    { id: "mp-ruins", stageIndex: 0x31, multiplayer: true },
    { id: "mp-car-park", stageIndex: 0x2d, multiplayer: true },
    { id: "mp-warehouse", stageIndex: 0x2c, multiplayer: true },
    { id: "mp-sewers", stageIndex: 0x32, multiplayer: true },
    { id: "unused-title-sequence", stageIndex: 0x26, titleSequence: true },
    { id: "dev-test-silo", stageIndex: 0x01 },
    { id: "dev-test-arch", stageIndex: 0x04, characterGallery: true },
    { id: "dev-prop-gallery", stageIndex: 0x04, objectGallery: "props" },
    { id: "dev-door-gallery", stageIndex: 0x04, objectGallery: "doors" },
    { id: "dev-item-gallery", stageIndex: 0x04, objectGallery: "items" },
    { id: "dev-test-dest", stageIndex: 0x06 },
    { id: "dev-retaking", stageIndex: 0x07 },
    { id: "dev-test-run", stageIndex: 0x0f },
    { id: "dev-stage-24", stageIndex: 0x10 },
    { id: "dev-stage-28", stageIndex: 0x14 },
    { id: "dev-stage-2b", stageIndex: 0x17 },
    { id: "dev-test-ash", stageIndex: 0x1a },
    { id: "dev-test-len", stageIndex: 0x22 },
    { id: "dev-test-uff", stageIndex: 0x25 },
    { id: "dev-test-lam", stageIndex: 0x28 },
    { id: "dev-test-mp2", stageIndex: 0x2a, multiplayer: true },
    { id: "dev-test-mp6", stageIndex: 0x2e, multiplayer: true },
    { id: "dev-test-mp7", stageIndex: 0x2f, multiplayer: true },
    { id: "dev-test-mp8", stageIndex: 0x30, multiplayer: true },
    { id: "dev-test-mp14", stageIndex: 0x36, multiplayer: true },
    { id: "dev-test-mp16", stageIndex: 0x38, multiplayer: true },
    { id: "dev-test-mp17", stageIndex: 0x39, multiplayer: true },
    { id: "dev-test-mp18", stageIndex: 0x3a, multiplayer: true },
    { id: "dev-test-mp19", stageIndex: 0x3b, multiplayer: true },
    { id: "dev-test-mp20", stageIndex: 0x3c, multiplayer: true },
];

const setupCommandLengths = new Map<number, number>([
    [0x01, 55], [0x02, 2], [0x03, 23], [0x04, 24], [0x05, 23], [0x06, 49], [0x07, 24], [0x08, 26],
    [0x09, 11], [0x0a, 53], [0x0b, 140], [0x0c, 23], [0x0d, 43], [0x0e, 2], [0x0f, 23], [0x10, 1],
    [0x11, 23], [0x12, 2], [0x13, 5], [0x14, 42], [0x15, 26], [0x16, 4], [0x17, 4], [0x18, 1],
    [0x19, 2], [0x1a, 2], [0x1b, 2], [0x1c, 2], [0x1d, 2], [0x1e, 4], [0x1f, 1], [0x20, 4],
    [0x21, 5], [0x22, 1], [0x23, 4], [0x24, 23], [0x25, 10], [0x26, 4], [0x27, 34], [0x28, 35],
    [0x29, 1], [0x2a, 24], [0x2b, 23], [0x2c, 5], [0x2d, 32], [0x2e, 7], [0x2f, 26], [0x30, 37],
    [0x31, 5], [0x32, 4], [0x33, 56], [0x34, 1], [0x35, 39], [0x36, 29], [0x37, 38], [0x38, 3],
    [0x39, 58], [0x3a, 26], [0x3b, 27],
]);

const OBJTYPE_DOOR = 0x01;
const OBJTYPE_DOORSCALE = 0x02;
const OBJTYPE_KEY = 0x04;
const OBJTYPE_AMMOCRATE = 0x07;
const OBJTYPE_WEAPON = 0x08;
const OBJTYPE_CHR = 0x09;
const OBJTYPE_HAT = 0x11;
const OBJTYPE_MULTIAMMOCRATE = 0x14;
const OBJTYPE_SHIELD = 0x15;
const OBJTYPE_CONDITIONALSCENERY = 0x31;
const OBJTYPE_LIFT = 0x30;
const OBJTYPE_MINE = 0x3a;
const OBJFLAG_ASSIGNEDTOCHR = 0x00004000;
const OBJFLAG_INSIDEANOTHEROBJ = 0x00008000;
const OBJFLAG_CORE_GEO_INUSE = 0x00000100;
const OBJFLAG_DOOR_KEEPOPEN = 0x40000000;
const OBJFLAG_WEAPON_LEFTHANDED = 0x10000000;
const OBJFLAG_WEAPON_AICANNOTUSE = 0x20000000;
const OBJFLAG2_EXCLUDE_AGENT = 0x00000010;
const OBJFLAG2_INVISIBLE = 0x00080000;
const OBJFLAG2_MULTIPLAYER_PLAYER_COUNT = 0x01c00000;
const OBJFLAG3_WALKTHROUGH = 0x00000400;
const OBJFLAG3_GEOCYL = 0x02000000;
const DOORFLAG_DEFORM = 0x0004;
const DOORFLAG_FLIP = 0x0008;
const DOORFLAG_ROTATEDPAD = 0x0040;
const DOORTYPE_VERTICAL = 4;
const SPAWNFLAG_ONLY_AGENT = 0x00000020;
const SPAWNFLAG_ONLY_SPECIAL_AGENT = 0x00000040;
const SPAWNFLAG_ONLY_PERFECT_AGENT = 0x00000080;
const SPAWNFLAG_HIDDEN = 0x00001000;
const SPAWNFLAG_FORCESUNGLASSES = 0x00000001;
const SPAWNFLAG_MAYBESUNGLASSES = 0x00000002;
const CHARACTER_HEAD_PART = 0x0004;
const DEFAULT_MALE_GUARD_HEAD = 0x0018;
const DEFAULT_FEMALE_GUARD_HEAD = 0x0021;
const BODY_FEM_GUARD = 0x0068;
const HEAD_PART_SUNGLASSES = 0x0000;
const HEAD_PART_EYES_CLOSED = 0x0003;
const HEAD_PART_HUD_PIECE = 0x0004;
const MALE_GUARD_HEADS = [
    0x18, 0x13, 0x16, 0x11, 0x06, 0x14, 0x12, 0x1b, 0x1c, 0x1a, 0x3b, 0x37, 0x42, 0x43,
    0x48, 0x54, 0x0b, 0x2a, 0x1e, 0x1f, 0x22, 0x23, 0x25, 0x26, 0x27, 0x2d, 0x2e, 0x49,
    0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x55, 0x3f, 0x40, 0x41, 0x44,
];
const FEMALE_GUARD_HEADS = [0x21, 0x20, 0x24, 0x2c];
const FEM_GUARD_HEADS = [0x45, 0x46, 0x47];
const CHARACTER_RIGHT_HAND_PART = 0x0003;
const CHARACTER_LEFT_HAND_PART = 0x0005;
const CHARACTER_HAT_PART = 0x0006;
const SKEDAR_RIGHT_HAND_PART = 0x0002;
const SKEDAR_LEFT_HAND_PART = 0x0003;
const HUMAN_SKELETON_ID = 0x0009;
const HUMAN_SKELETON_PART_COUNT = 15;
const HUMAN_STANDING_ANIMATION = 0x006a;
const SKEDAR_SKELETON_ID = 0x001c;
const SKEDAR_SKELETON_PART_COUNT = 36;
const SKEDAR_STANDING_ANIMATION = 0x00c0;
const DR_CAROLL_SKELETON_ID = 0x0028;
const DR_CAROLL_SKELETON_PART_COUNT = 4;
const DR_CAROLL_STANDING_ANIMATION = 0x013e;
const ROBOT_SKELETON_ID = 0x0034;
const ROBOT_SKELETON_PART_COUNT = 3;
const ROBOT_STANDING_ANIMATION = 0x0237;
const CHARACTER_GALLERY_BODY_NUMS = [0x00, 0x01, 0x02, 0x03, ...Array.from({ length: 0x41 }, (_, i) => 0x56 + i).filter((bodyNum) => bodyNum !== 0x70)];

function hashDeterministicChoice(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function makeDeterministicHeadPool(stageId: string, gender: string, availableHeads: readonly number[], count: number): number[] {
    const heads = [...availableHeads];
    let state = hashDeterministicChoice(`${stageId}:${gender}`);
    for (let i = heads.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const j = state % (i + 1);
        [heads[i], heads[j]] = [heads[j], heads[i]];
    }
    return Array.from({ length: count }, (_, index) => heads[index % heads.length]);
}

const CHARACTER_GALLERY_HEADS = new Map<number, number>([
    [0x56, 0x04], [0x57, 0x05], [0x5a, 0x07], [0x5b, 0x08], [0x5d, 0x09], [0x5e, 0x0a],
    [0x61, 0x0c], [0x62, 0x04], [0x65, 0x0d], [0x66, 0x0e], [0x67, 0x0f], [0x68, 0x10],
    [0x6d, 0x0c], [0x71, 0x1d], [0x79, 0x3d], [0x83, 0x29], [0x86, 0x04], [0x87, 0x2f],
    [0x88, 0x2f], [0x89, 0x3c], [0x8a, 0x04], [0x8c, 0x30], [0x90, 0x07], [0x91, 0x28],
    [0x94, 0x05], [0x95, 0x04], [0x96, 0x04],
]);

const multiplayerRuntimeObjectTypes = new Set([
    OBJTYPE_DOOR, OBJTYPE_KEY, OBJTYPE_AMMOCRATE, OBJTYPE_WEAPON, OBJTYPE_CHR,
    OBJTYPE_HAT, OBJTYPE_MULTIAMMOCRATE, OBJTYPE_SHIELD, OBJTYPE_LIFT, OBJTYPE_MINE,
]);

const renderableObjectTypes = new Set([
    0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x0b, 0x0c, 0x0d, 0x0f, 0x11, 0x14, 0x15,
    0x24, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2f, 0x30, 0x33, 0x35, 0x36, 0x37, 0x39, 0x3a, 0x3b,
]);

const itemObjectTypes = new Set([
    OBJTYPE_KEY, OBJTYPE_AMMOCRATE, OBJTYPE_WEAPON, OBJTYPE_HAT,
    OBJTYPE_MULTIAMMOCRATE, OBJTYPE_SHIELD, OBJTYPE_MINE,
]);

function findBytes(data: Uint8Array, pattern: number[]): number {
    outer: for (let i = 0; i <= data.byteLength - pattern.length; i++) {
        for (let j = 0; j < pattern.length; j++) {
            if (data[i + j] !== pattern[j])
                continue outer;
        }
        return i;
    }
    return -1;
}

function readRomFile(rom: Uint8Array, dataView: DataView, fileTableOffset: number, fileId: number): Uint8Array {
    const currentOffset = dataView.getUint32(fileTableOffset + fileId * 4, false);
    const nextOffset = dataView.getUint32(fileTableOffset + (fileId + 1) * 4, false);
    if (currentOffset === 0 || nextOffset <= currentOffset || nextOffset > rom.byteLength)
        throw new Error(`Invalid ROM file-table entry 0x${fileId.toString(16)}`);
    return inflateBgChunk(rom.subarray(currentOffset, nextOffset), `ROM file 0x${fileId.toString(16)}`);
}

function buildObjectGalleryCatalog(
    rom: Uint8Array,
    dataView: DataView,
    version: RomVersion,
    stageTable: StageTableEntry[],
    modelStates: { fileId: number; scale: number }[],
): ObjectGalleryCatalog {
    const catalogs: Record<ObjectGalleryKind, Map<string, ObjectGalleryEntry>> = {
        props: new Map(),
        doors: new Map(),
        items: new Map(),
    };
    const setupFileIds = new Set<number>();

    for (const stage of stageExtractions) {
        if (stage.id.startsWith("dev-"))
            continue;
        const stageEntry = stageTable[stage.stageIndex];
        const setupFileId = stage.multiplayer ? stageEntry.multiplayerSetupFileId : stageEntry.setupFileId;
        if (setupFileIds.has(setupFileId))
            continue;
        setupFileIds.add(setupFileId);

        const setup = readRomFile(rom, dataView, version.fileTableOffset, setupFileId);
        const setupView = new DataView(setup.buffer, setup.byteOffset, setup.byteLength);
        let offs = setupView.getUint32(0x10, false);
        if (offs <= 0 || offs >= setup.byteLength)
            throw new Error(`Object gallery setup 0x${setupFileId.toString(16)} has an invalid props offset 0x${offs.toString(16)}`);

        for (let commandIndex = 0; commandIndex < 0x10000; commandIndex++) {
            if (offs + 4 > setup.byteLength)
                throw new Error(`Object gallery setup 0x${setupFileId.toString(16)} command ${commandIndex} points outside its file`);
            const word0 = setupView.getUint32(offs, false);
            const type = word0 & 0xff;
            if (type === 0x34)
                break;
            const length = setupCommandLengths.get(type);
            if (length === undefined || offs + length * 4 > setup.byteLength)
                throw new Error(`Object gallery setup 0x${setupFileId.toString(16)} has invalid command 0x${type.toString(16)} at 0x${offs.toString(16)}`);

            if (renderableObjectTypes.has(type)) {
                const modelNum = setupView.getInt16(offs + 0x04, false);
                const modelState = modelStates[modelNum];
                if (modelState !== undefined && modelState.fileId !== 0) {
                    const doorFlags = type === OBJTYPE_DOOR ? setupView.getUint16(offs + 0x70, false) : 0;
                    const doorType = type === OBJTYPE_DOOR ? setupView.getUint16(offs + 0x72, false) : 0;
                    const kind: ObjectGalleryKind = type === OBJTYPE_DOOR ? "doors" : itemObjectTypes.has(type) ? "items" : "props";
                    const key = kind === "doors"
                        ? `${modelNum}:${doorFlags & DOORFLAG_DEFORM}:${(doorFlags & DOORFLAG_DEFORM) !== 0 ? doorType : -1}`
                        : `${type}:${modelNum}`;
                    if (!catalogs[kind].has(key)) {
                        catalogs[kind].set(key, {
                            type,
                            modelNum,
                            extraScale: word0 >>> 16,
                            doorFlags,
                            doorType,
                        });
                    }
                }
            }
            offs += length * 4;
        }
    }

    const sorted = (entries: Map<string, ObjectGalleryEntry>): ObjectGalleryEntry[] => [...entries.values()]
        .sort((a, b) => a.type - b.type || a.modelNum - b.modelNum || a.doorType - b.doorType || a.doorFlags - b.doorFlags);
    return {
        props: sorted(catalogs.props),
        doors: sorted(catalogs.doors),
        items: sorted(catalogs.items),
    };
}

function readAnimationBits(data: Uint8Array, bitLength: number, bitOffset: number): number {
    let value = 0;
    for (let i = 0; i < bitLength; i++) {
        const offs = bitOffset + i;
        value = value * 2 + ((data[offs >>> 3] >>> (7 - (offs & 7))) & 1);
    }
    return value;
}

function readSignedAnimationBits(data: Uint8Array, bitLength: number, bitOffset: number): number {
    if (bitLength === 0)
        return 0;
    const value = readAnimationBits(data, bitLength, bitOffset);
    return (value & (1 << (bitLength - 1))) !== 0 ? value - 2 ** bitLength : value;
}

function animationBitsToFloat(data: Uint8Array, bitOffset: number): number {
    const bits = readAnimationBits(data, 32, bitOffset);
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, bits, false);
    return new DataView(buffer).getFloat32(0, false);
}

function parseAnimationPose(rom: Uint8Array, version: RomVersion, animationNum: number, frame: number, partCount: number): AnimationPose {
    const romView = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const animationCount = romView.getUint32(version.animationTableOffset, false);
    if (animationNum < 0 || animationNum >= animationCount)
        throw new Error(`Perfect Dark animation ${animationNum} is outside the ${animationCount}-entry table`);

    const tableEntry = version.animationTableOffset + 4 + animationNum * 0x0c;
    const frameCount = romView.getUint16(tableEntry + 0x00, false);
    const bytesPerFrame = romView.getUint16(tableEntry + 0x02, false);
    const dataOffset = romView.getUint32(tableEntry + 0x04, false);
    const headerLength = romView.getUint16(tableEntry + 0x08, false);
    const frameLength = romView.getUint8(tableEntry + 0x0a);
    if (frame < 0 || frame >= frameCount)
        throw new Error(`Perfect Dark animation ${animationNum} frame ${frame} is outside its ${frameCount} frames`);

    const headerOffset = version.animationDataOffset + dataOffset;
    const frameOffset = headerOffset + headerLength + frame * bytesPerFrame;
    if (headerOffset < 0 || frameOffset + bytesPerFrame > version.animationTableOffset)
        throw new Error(`Perfect Dark animation ${animationNum} points outside the animation segment`);
    const header = rom.subarray(headerOffset, headerOffset + headerLength);
    const frameData = rom.subarray(frameOffset, frameOffset + bytesPerFrame);
    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const pose: AnimationPose = [];
    let headerCursor = 0;
    let frameBitOffset = 0;

    for (let part = 0; part < partCount; part++) {
        if (headerCursor >= header.byteLength)
            throw new Error(`Perfect Dark animation ${animationNum} has no header for skeleton part ${part}`);
        const flags = header[headerCursor++];
        const translation: [number, number, number] = [0, 0, 0];
        const rotation: [number, number, number] = [0, 0, 0];
        const scale: [number, number, number] = [1, 1, 1];

        if ((flags & 0x02) !== 0) {
            for (let axis = 0; axis < 3; axis++) {
                const bitLength = header[headerCursor + 2];
                const base = headerView.getUint16(headerCursor, false);
                const value = base + readSignedAnimationBits(frameData, bitLength, frameBitOffset);
                translation[axis] = (value << 16) >> 16;
                frameBitOffset += bitLength;
                headerCursor += 3;
            }
        } else if ((flags & 0x20) !== 0) {
            for (let axis = 0; axis < 3; axis++) {
                const bitLength = header[headerCursor];
                const base = headerView.getInt32(headerCursor + 1, false);
                translation[axis] = (base + readAnimationBits(frameData, bitLength, frameBitOffset)) * 0.001;
                frameBitOffset += bitLength;
                headerCursor += 5;
            }
        } else if ((flags & 0x08) !== 0) {
            frameBitOffset += header[headerCursor + 2] + header[headerCursor + 5]
                + header[headerCursor + 8] + header[headerCursor + 11];
            headerCursor += 12;
        }

        if ((flags & 0x01) !== 0) {
            for (let axis = 0; axis < 3; axis++) {
                const bitLength = header[headerCursor + 2];
                let value = headerView.getUint16(headerCursor, false) + readAnimationBits(frameData, bitLength, frameBitOffset);
                value = (value << (16 - frameLength)) & 0xffff;
                rotation[axis] = value * Math.PI * 2 / 65536;
                frameBitOffset += bitLength;
                headerCursor += 3;
            }
        } else if ((flags & 0x10) !== 0) {
            for (let axis = 0; axis < 3; axis++) {
                rotation[axis] = animationBitsToFloat(frameData, frameBitOffset);
                frameBitOffset += 32;
            }
        }

        if ((flags & 0x40) !== 0) {
            frameBitOffset += header[headerCursor];
            headerCursor += 5;
        }
        if ((flags & 0x80) !== 0) {
            for (let axis = 0; axis < 3; axis++) {
                scale[axis] = animationBitsToFloat(frameData, frameBitOffset);
                frameBitOffset += 32;
            }
        }
        pose.push({ rotation, translation, scale });
    }
    return pose;
}

function parseStageTable(dataSegment: Uint8Array): StageTableEntry[] {
    const signature = [0x00, 0x1b, 0x01, 0x76, 0x01, 0x83, 0x01, 0x42, 0x01, 0x1e];
    const fieldsOffset = findBytes(dataSegment, signature);
    if (fieldsOffset < 8)
        throw new Error("Could not locate the Perfect Dark stage table");

    const tableOffset = fieldsOffset - 8;
    const view = new DataView(dataSegment.buffer, dataSegment.byteOffset, dataSegment.byteLength);
    const entries: StageTableEntry[] = [];
    for (let i = 0; i < 61; i++) {
        const offs = tableOffset + i * 0x38;
        entries.push({
            bgFileId: view.getUint16(offs + 0x08, false),
            tileFileId: view.getUint16(offs + 0x0a, false),
            padsFileId: view.getUint16(offs + 0x0c, false),
            setupFileId: view.getUint16(offs + 0x0e, false),
            multiplayerSetupFileId: view.getUint16(offs + 0x10, false),
        });
    }
    return entries;
}

function parseCollisionTiles(data: Uint8Array): Map<number, FloorTriangle[]> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.byteLength < 8)
        throw new Error("Perfect Dark collision-tile file is too small");
    const roomCount = view.getUint32(0x00, false);
    if (roomCount > 0x1000 || 4 + (roomCount + 1) * 4 > data.byteLength)
        throw new Error(`Perfect Dark collision-tile file has invalid room count ${roomCount}`);

    const trianglesByRoom = new Map<number, FloorTriangle[]>();
    for (let room = 0; room < roomCount; room++) {
        let offs = view.getUint32(0x04 + room * 4, false);
        const end = view.getUint32(0x08 + room * 4, false);
        if (offs > end || end > data.byteLength)
            throw new Error(`Perfect Dark collision room ${room} has an invalid byte range`);
        const triangles: FloorTriangle[] = [];
        while (offs < end) {
            if (offs + 0x0e > end)
                throw new Error(`Perfect Dark collision tile in room ${room} has a truncated header`);
            const type = view.getUint8(offs + 0x00);
            const vertexCount = view.getUint8(offs + 0x01);
            const flags = view.getUint16(offs + 0x02, false);
            const size = 0x0e + vertexCount * 6;
            if (type !== 0 || vertexCount < 3 || offs + size > end)
                throw new Error(`Perfect Dark collision room ${room} has an invalid tile at 0x${offs.toString(16)}`);

            if ((flags & 0x0003) !== 0) {
                const vertices: [number, number, number][] = [];
                for (let i = 0; i < vertexCount; i++) {
                    const vertexOffs = offs + 0x0e + i * 6;
                    vertices.push([
                        view.getInt16(vertexOffs + 0x00, false),
                        view.getInt16(vertexOffs + 0x02, false),
                        view.getInt16(vertexOffs + 0x04, false),
                    ]);
                }
                for (let i = 1; i + 1 < vertices.length; i++)
                    triangles.push({ a: vertices[0], b: vertices[i], c: vertices[i + 1] });
            }
            offs += size;
        }
        trianglesByRoom.set(room, triangles);
    }
    return trianglesByRoom;
}

function parseModelStates(dataSegment: Uint8Array, modelCount: number): { fileId: number; scale: number }[] {
    const signature = [
        0x00, 0x00, 0x00, 0x00, 0x01, 0xc6, 0x01, 0x99,
        0x00, 0x00, 0x00, 0x00, 0x01, 0xca, 0x01, 0x99,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x99,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x83, 0x01, 0x99,
    ];
    const tableOffset = findBytes(dataSegment, signature);
    if (tableOffset < 0)
        throw new Error("Could not locate the Perfect Dark model-state table");

    const view = new DataView(dataSegment.buffer, dataSegment.byteOffset, dataSegment.byteLength);
    return Array.from({ length: modelCount }, (_, i) => ({
        fileId: view.getUint16(tableOffset + i * 8 + 4, false),
        scale: view.getUint16(tableOffset + i * 8 + 6, false) / 4096,
    }));
}

function parseHeadBodyStates(dataSegment: Uint8Array): HeadBodyState[] {
    const view = new DataView(dataSegment.buffer, dataSegment.byteOffset, dataSegment.byteLength);
    let tableOffset = -1;
    for (let offs = 0; offs + 0x50 <= dataSegment.byteLength; offs += 2) {
        if (view.getUint16(offs + 0x02, false) === 0x0047
                && view.getUint16(offs + 0x16, false) === 0x0199
                && view.getUint16(offs + 0x2a, false) === 0x019b
                && view.getUint16(offs + 0x3e, false) === 0x019a) {
            tableOffset = offs;
            break;
        }
    }
    if (tableOffset < 0)
        throw new Error("Could not locate the Perfect Dark head/body table");

    return Array.from({ length: 152 }, (_, i) => {
        const offs = tableOffset + i * 0x14;
        return {
            isMale: (view.getUint16(offs, false) & 0x8000) !== 0,
            hasEmbeddedHead: (view.getUint16(offs, false) & 0x4000) !== 0,
            fileId: view.getUint16(offs + 0x02, false),
            scale: view.getFloat32(offs + 0x04, false) * 0.1,
            animationScale: view.getFloat32(offs + 0x08, false),
        };
    });
}

function parsePads(data: Uint8Array): PadData[] {
    if (data.byteLength < 0x14)
        return [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = view.getInt32(0x00, false);
    if (count < 0 || count > 0x4000 || 0x14 + count * 2 > data.byteLength)
        throw new Error(`Invalid Perfect Dark pad count ${count}`);

    const readVector = (offs: number): [number, number, number] => [
        view.getFloat32(offs + 0x00, false),
        view.getFloat32(offs + 0x04, false),
        view.getFloat32(offs + 0x08, false),
    ];
    const alignedVector = (flags: number, xFlag: number, yFlag: number, zFlag: number, invertFlag: number): [number, number, number] => {
        const sign = flags & invertFlag ? -1 : 1;
        if (flags & xFlag)
            return [sign, 0, 0];
        if (flags & yFlag)
            return [0, sign, 0];
        if (flags & zFlag)
            return [0, 0, sign];
        throw new Error("Pad vector is not axis aligned");
    };

    const pads: PadData[] = [];
    for (let i = 0; i < count; i++) {
        let offs = view.getUint16(0x14 + i * 2, false);
        if (offs + 4 > data.byteLength)
            throw new Error(`Pad ${i} points outside its file`);
        const header = view.getUint32(offs, false);
        const flags = header >>> 14;
        const room = (header << 18) >> 22;
        offs += 4;

        let position: [number, number, number];
        if (flags & 0x0001) {
            position = [view.getInt16(offs, false), view.getInt16(offs + 2, false), view.getInt16(offs + 4, false)];
            offs += 8;
        } else {
            position = readVector(offs);
            offs += 12;
        }

        let up: [number, number, number];
        if (flags & 0x000e) {
            up = alignedVector(flags, 0x0002, 0x0004, 0x0008, 0x0010);
        } else {
            up = readVector(offs);
            offs += 12;
        }

        let look: [number, number, number];
        if (flags & 0x00e0) {
            look = alignedVector(flags, 0x0020, 0x0040, 0x0080, 0x0100);
        } else {
            look = readVector(offs);
            offs += 12;
        }

        const normal: [number, number, number] = [
            up[1] * look[2] - look[1] * up[2],
            up[2] * look[0] - look[2] * up[0],
            up[0] * look[1] - look[0] * up[1],
        ];
        const hasBbox = (flags & 0x0200) !== 0;
        const bbox: [number, number, number, number, number, number] = hasBbox ? [
            view.getFloat32(offs + 0x00, false), view.getFloat32(offs + 0x04, false),
            view.getFloat32(offs + 0x08, false), view.getFloat32(offs + 0x0c, false),
            view.getFloat32(offs + 0x10, false), view.getFloat32(offs + 0x14, false),
        ] : [-100, 100, -100, 100, -100, 100];
        pads.push({ position, look, up, normal, bbox, hasBbox, room, flags });
    }
    return pads;
}

interface NavigationAudit {
    waypointCount: number;
    waypointEdgeCount: number;
    waygroupCount: number;
    waygroupEdgeCount: number;
    unresolvedWaypointPadRoomCount: number;
}

function validatePadNavigation(data: Uint8Array, pads: PadData[]): NavigationAudit {
    if (data.byteLength < 0x14)
        return { waypointCount: 0, waypointEdgeCount: 0, waygroupCount: 0, waygroupEdgeCount: 0, unresolvedWaypointPadRoomCount: 0 };
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const waypointOffset = view.getInt32(0x08, false);
    const waygroupOffset = view.getInt32(0x0c, false);
    if (waypointOffset <= 0 || waygroupOffset <= 0)
        return { waypointCount: 0, waypointEdgeCount: 0, waygroupCount: 0, waygroupEdgeCount: 0, unresolvedWaypointPadRoomCount: 0 };

    const readIndexList = (offset: number, label: string): number[] => {
        if (offset < 0 || offset + 4 > data.byteLength)
            throw new Error(`${label} points outside its pad file`);
        const values: number[] = [];
        for (let i = 0; i < 0x10000; i++) {
            const offs = offset + i * 4;
            if (offs + 4 > data.byteLength)
                throw new Error(`${label} has no terminator`);
            const value = view.getInt32(offs, false);
            if (value < 0)
                return values;
            values.push(value & 0x3fff);
        }
        throw new Error(`${label} exceeds 65536 entries`);
    };

    const waypoints: { padNum: number; neighboursOffset: number; groupNum: number }[] = [];
    for (let i = 0; i < 0x10000; i++) {
        const offs = waypointOffset + i * 0x10;
        if (offs < 0 || offs + 0x10 > data.byteLength)
            throw new Error("Perfect Dark waypoint table has no terminator");
        const padNum = view.getInt32(offs, false);
        if (padNum < 0)
            break;
        if (padNum >= pads.length)
            throw new Error(`Perfect Dark waypoint ${i} references invalid pad ${padNum}`);
        waypoints.push({ padNum, neighboursOffset: view.getUint32(offs + 0x04, false), groupNum: view.getInt32(offs + 0x08, false) });
    }

    const waygroups: { neighboursOffset: number; waypointsOffset: number }[] = [];
    for (let i = 0; i < 0x10000; i++) {
        const offs = waygroupOffset + i * 0x0c;
        if (offs < 0 || offs + 0x0c > data.byteLength)
            throw new Error("Perfect Dark waygroup table has no terminator");
        const neighboursOffset = view.getUint32(offs, false);
        if (neighboursOffset === 0)
            break;
        waygroups.push({ neighboursOffset, waypointsOffset: view.getUint32(offs + 0x04, false) });
    }

    let waypointEdgeCount = 0;
    for (let i = 0; i < waypoints.length; i++) {
        const waypoint = waypoints[i];
        if (waypoint.groupNum < 0 || waypoint.groupNum >= waygroups.length)
            throw new Error(`Perfect Dark waypoint ${i} references invalid group ${waypoint.groupNum}`);
        const neighbours = readIndexList(waypoint.neighboursOffset, `Perfect Dark waypoint ${i} neighbours`);
        for (const neighbour of neighbours) {
            if (neighbour >= waypoints.length)
                throw new Error(`Perfect Dark waypoint ${i} references invalid waypoint ${neighbour}`);
        }
        waypointEdgeCount += neighbours.length;
    }

    let waygroupEdgeCount = 0;
    for (let i = 0; i < waygroups.length; i++) {
        const group = waygroups[i];
        const neighbours = readIndexList(group.neighboursOffset, `Perfect Dark waygroup ${i} neighbours`);
        const members = readIndexList(group.waypointsOffset, `Perfect Dark waygroup ${i} waypoints`);
        for (const neighbour of neighbours) {
            if (neighbour >= waygroups.length)
                throw new Error(`Perfect Dark waygroup ${i} references invalid group ${neighbour}`);
        }
        for (const waypoint of members) {
            if (waypoint >= waypoints.length)
                throw new Error(`Perfect Dark waygroup ${i} references invalid waypoint ${waypoint}`);
            if (waypoints[waypoint].groupNum !== i)
                throw new Error(`Perfect Dark waypoint ${waypoint} belongs to group ${waypoints[waypoint].groupNum}, not ${i}`);
        }
        waygroupEdgeCount += neighbours.length;
    }
    return {
        waypointCount: waypoints.length,
        waypointEdgeCount,
        waygroupCount: waygroups.length,
        waygroupEdgeCount,
        unresolvedWaypointPadRoomCount: waypoints.filter((waypoint) => pads[waypoint.padNum].room <= 0).length,
    };
}

class ModelGeometryBuilder {
    public readonly vertices: OutputVertex[] = [];
    public readonly batches = new Map<string, OutputBatch>();
    public readonly textureIds = new Set<number>();
    public readonly textureSubcommands = new Set<number>();

    public addVertex(vertex: OutputVertex): number {
        this.vertices.push(vertex);
        return this.vertices.length - 1;
    }

    public addTriangle(textureId: number, secondaryTextureId: number, flags: number, i0: number, i1: number, i2: number): void {
        const key = `${flags}:${textureId}:${secondaryTextureId}`;
        let batch = this.batches.get(key);
        if (batch === undefined) {
            batch = { textureId, secondaryTextureId, flags, indices: [] };
            this.batches.set(key, batch);
        }
        batch.indices.push(i0, i1, i2);
        if (textureId !== 0xffff)
            this.textureIds.add(textureId);
        if (secondaryTextureId !== 0xffff)
            this.textureIds.add(secondaryTextureId);
    }
}

function parseModelDisplayList(
    builder: ModelGeometryBuilder,
    data: Uint8Array,
    startOffset: number,
    verticesOffset: number,
    colorsOffset: number,
    defaultTransform: mat4,
    matrixTransforms: (mat4 | null)[],
    translucent: boolean,
): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const vertexCache = new Int32Array(64).fill(-1);
    const visited = new Set<number>();
    const transformed = vec3.create();
    let textureId = 0xffff;
    let secondaryTextureId = 0xffff;
    let materialFlags = translucent ? BATCH_FLAG_TRANSLUCENT : 0;
    let geometryMode = 0x00000004;
    let colorPointer = colorsOffset;
    let activeTransform = defaultTransform;

    const resolveSegmentedOffset = (address: number, fallbackBase: number): number => {
        const segment = address >>> 24;
        const offset = address & 0x00ffffff;
        if (segment === 0x04)
            return verticesOffset + offset;
        if (segment === 0x05)
            return offset;
        if (segment === 0x06)
            return colorsOffset + offset;
        return fallbackBase + offset;
    };

    const emitTriangle = (i0: number, i1: number, i2: number): void => {
        const v0 = vertexCache[i0];
        const v1 = vertexCache[i1];
        const v2 = vertexCache[i2];
        if (v0 < 0 || v1 < 0 || v2 < 0 || i0 === i1 && i1 === i2)
            return;
        builder.addTriangle(textureId, secondaryTextureId, materialFlags, v0, v1, v2);
    };

    const run = (displayListOffset: number, depth: number): void => {
        if (depth > 16)
            throw new Error("Perfect Dark model display-list recursion exceeded 16 levels");
        let offs = displayListOffset;
        for (let commandIndex = 0; commandIndex < 0x10000; commandIndex++, offs += 8) {
            if (offs < 0 || offs + 8 > data.byteLength)
                throw new Error(`Model display list points outside its file at 0x${offs.toString(16)}`);
            if (visited.has(offs))
                return;
            visited.add(offs);

            const w0 = view.getUint32(offs, false);
            const w1 = view.getUint32(offs + 4, false);
            const opcode = w0 >>> 24;
            switch (opcode) {
            case 0x01: {
                const segment = w1 >>> 24;
                const matrixOffset = w1 & 0x00ffffff;
                if (segment === 0x03 && matrixOffset % 0x40 === 0) {
                    const matrixIndex = matrixOffset / 0x40;
                    activeTransform = matrixTransforms[matrixIndex] ?? defaultTransform;
                }
                break;
            }
            case 0x04: {
                const count = ((w0 >>> 20) & 0x0f) + 1;
                const vertexStride = (w0 & 0xffff) / count;
                if (vertexStride !== 12 && vertexStride !== 16)
                    throw new Error(`Perfect Dark model uses unsupported ${vertexStride}-byte vertices`);
                const destination = (w0 >>> 16) & 0x0f;
                const vertexStart = resolveSegmentedOffset(w1, verticesOffset);
                for (let i = 0; i < count && destination + i < vertexCache.length; i++) {
                    const vertexOffs = vertexStart + i * vertexStride;
                    if (vertexOffs < 0 || vertexOffs + vertexStride > data.byteLength)
                        break;
                    const colorIndex = view.getUint16(vertexOffs + 0x06, false) & 0xfffc;
                    const [r, g, b, a] = readColor(data, colorPointer + colorIndex, (geometryMode & 0x00020000) !== 0);
                    vec3.transformMat4(transformed, [
                        view.getInt16(vertexOffs + 0x00, false),
                        view.getInt16(vertexOffs + 0x02, false),
                        view.getInt16(vertexOffs + 0x04, false),
                    ], activeTransform);
                    vertexCache[destination + i] = builder.addVertex({
                        x: transformed[0], y: transformed[1], z: transformed[2],
                        s: view.getInt16(vertexOffs + 0x08, false),
                        t: view.getInt16(vertexOffs + 0x0a, false),
                        r, g, b, a,
                    });
                }
                break;
            }
            case 0x06:
                run(resolveSegmentedOffset(w1, 0), depth + 1);
                if (((w0 >>> 16) & 1) !== 0)
                    return;
                break;
            case 0x07:
                colorPointer = resolveSegmentedOffset(w1, colorsOffset);
                break;
            case 0xb1: {
                const triangles = [
                    [w1 & 0x0f, (w1 >>> 4) & 0x0f, w0 & 0x0f],
                    [(w1 >>> 8) & 0x0f, (w1 >>> 12) & 0x0f, (w0 >>> 4) & 0x0f],
                    [(w1 >>> 16) & 0x0f, (w1 >>> 20) & 0x0f, (w0 >>> 8) & 0x0f],
                    [(w1 >>> 24) & 0x0f, (w1 >>> 28) & 0x0f, (w0 >>> 12) & 0x0f],
                ];
                for (const [i0, i1, i2] of triangles)
                    emitTriangle(i0, i1, i2);
                break;
            }
            case 0xb6:
                geometryMode &= ~w1;
                break;
            case 0xb7:
                geometryMode |= w1;
                break;
            case 0xb8:
                return;
            case 0xbf:
                emitTriangle(Math.floor(((w1 >>> 16) & 0xff) / 10), Math.floor(((w1 >>> 8) & 0xff) / 10), Math.floor((w1 & 0xff) / 10));
                break;
            case 0xc0: {
                textureId = w1 & 0x0fff;
                const textureSubcommand = w0 & 0x07;
                secondaryTextureId = textureSubcommand === 1 ? (w1 >>> 12) & 0x0fff : 0xffff;
                builder.textureSubcommands.add(textureSubcommand);
                materialFlags = (translucent ? BATCH_FLAG_TRANSLUCENT : 0)
                    | (((w0 >>> 22) & 0x03) << 1)
                    | (((w0 >>> 20) & 0x03) << 3)
                    | (((w0 >>> 14) & 0x0f) << 5)
                    | (((w0 >>> 10) & 0x0f) << 9)
                    | (secondaryTextureId !== 0xffff ? BATCH_FLAG_SECONDARY_TEXTURE : 0);
                break;
            }
            }
        }
        throw new Error("Perfect Dark model display list did not terminate");
    };

    run(startOffset, 0);
}

function detectModelVertexStride(data: Uint8Array, ...displayListOffsets: number[]): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const visited = new Set<number>();
    const run = (displayListOffset: number, depth: number): number | null => {
        if (depth > 16 || displayListOffset === 0)
            return null;
        for (let offs = displayListOffset, i = 0; i < 0x10000 && offs + 8 <= data.byteLength; i++, offs += 8) {
            if (visited.has(offs))
                return null;
            visited.add(offs);
            const w0 = view.getUint32(offs, false);
            const w1 = view.getUint32(offs + 4, false);
            const opcode = w0 >>> 24;
            if (opcode === 0x04) {
                const count = ((w0 >>> 20) & 0x0f) + 1;
                const stride = (w0 & 0xffff) / count;
                if (stride === 12 || stride === 16)
                    return stride;
            } else if (opcode === 0x06) {
                const nested = run(w1 & 0x00ffffff, depth + 1);
                if (nested !== null)
                    return nested;
                if (((w0 >>> 16) & 1) !== 0)
                    return null;
            } else if (opcode === 0xb8) {
                return null;
            }
        }
        return null;
    };
    for (const offset of displayListOffsets) {
        const stride = run(offset, 0);
        if (stride !== null)
            return stride;
    }
    return 12;
}

function makeModelNodeTransform(rotation: [number, number, number], position: [number, number, number], scale: [number, number, number]): mat4 {
    const [x, y, z] = rotation;
    const xcos = Math.cos(x);
    const xsin = Math.sin(x);
    const ycos = Math.cos(y);
    const ysin = Math.sin(y);
    const zcos = Math.cos(z);
    const zsin = Math.sin(z);
    const a = xsin * zsin;
    const b = xcos * zsin;
    const c = xsin * zcos;
    const d = xcos * zcos;
    const transform = mat4.fromValues(
        ycos * zcos, ycos * zsin, -ysin, 0,
        c * ysin - xcos * zsin, a * ysin + xcos * zcos, xsin * ycos, 0,
        d * ysin + xsin * zsin, b * ysin - xsin * zcos, xcos * ycos, 0,
        position[0], position[1], position[2], 1,
    );
    mat4.scale(transform, transform, scale);
    return transform;
}

function makeHalfRotationModelNodeTransform(rotation: [number, number, number], position: [number, number, number]): mat4 {
    const fullRotation = makeModelNodeTransform(rotation, [0, 0, 0], [1, 1, 1]);
    const rotationMatrix = mat3.fromMat4(mat3.create(), fullRotation);
    const fullQuaternion = quat.normalize(quat.create(), quat.fromMat3(quat.create(), rotationMatrix));
    const halfQuaternion = quat.slerp(quat.create(), quat.create(), fullQuaternion, 0.5);
    return mat4.fromRotationTranslation(mat4.create(), halfQuaternion, position);
}

function isModelDistanceNodeVisible(near: number, far: number, distance: number): boolean {
    return (distance > near || near === 0) && distance <= far;
}

function parseModel(
    data: Uint8Array,
    animationPoses: ReadonlyMap<number, AnimationPose> | null = null,
    animationScale: number = 1,
    hiddenToggleParts: ReadonlySet<number> | null = null,
): ModelGeometry {
    if (data.byteLength < 0x1c)
        throw new Error("Perfect Dark model is smaller than its header");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const pointerOffset = (pointer: number): number => pointer === 0 ? 0 : pointer & 0x00ffffff;
    const rootNode = pointerOffset(view.getUint32(0x00, false));
    const skeletonId = view.getUint32(0x04, false);
    const partsOffset = pointerOffset(view.getUint32(0x08, false));
    const partCount = view.getUint16(0x0c, false);
    const matrixCount = view.getUint16(0x0e, false);
    const builder = new ModelGeometryBuilder();
    const visitedNodes = new Set<number>();
    const matrixTransforms: (mat4 | null)[] = new Array<mat4 | null>(matrixCount).fill(null);
    const displayLists: {
        opaque: number;
        translucent: number;
        vertices: number;
        numVertices: number;
        transform: mat4;
    }[] = [];
    let bbox: [number, number, number, number, number, number] | null = null;
    let rootPosition: [number, number, number] = [0, 0, 0];
    const partByNode = new Map<number, number>();
    const partTransforms = new Map<number, mat4>();
    const pose = animationPoses?.get(skeletonId) ?? null;
    if (partsOffset !== 0 && partsOffset + partCount * 6 <= data.byteLength) {
        for (let i = 0; i < partCount; i++) {
            const nodeOffset = pointerOffset(view.getUint32(partsOffset + i * 4, false));
            const part = view.getInt16(partsOffset + partCount * 4 + i * 2, false);
            if (nodeOffset !== 0)
                partByNode.set(nodeOffset, part);
        }
    }

    const visit = (firstNode: number, parentTransform: mat4): void => {
        for (let nodeOffset = firstNode; nodeOffset !== 0;) {
            if (visitedNodes.has(nodeOffset))
                return;
            visitedNodes.add(nodeOffset);
            if (nodeOffset < 0 || nodeOffset + 0x18 > data.byteLength)
                throw new Error(`Model node points outside its file at 0x${nodeOffset.toString(16)}`);

            const nodeType = view.getUint16(nodeOffset, false);
            const type = nodeType & 0xff;
            const rodataOffset = pointerOffset(view.getUint32(nodeOffset + 0x04, false));
            let childOffset = pointerOffset(view.getUint32(nodeOffset + 0x14, false));
            let transform = mat4.clone(parentTransform);

            if (type === 0x01 && pose !== null && rodataOffset + 0x02 <= data.byteLength) {
                const joint = pose[view.getUint16(rodataOffset, false)];
                if (joint !== undefined)
                    transform = mat4.multiply(mat4.create(), parentTransform, makeModelNodeTransform(joint.rotation, [0, 0, 0], joint.scale));
                if (rodataOffset + 0x04 <= data.byteLength) {
                    const matrixIndex = view.getInt16(rodataOffset + 0x02, false);
                    if (matrixIndex >= 0 && matrixIndex < matrixTransforms.length)
                        matrixTransforms[matrixIndex] = mat4.clone(transform);
                }
            } else if (type === 0x02 && rodataOffset + 0x14 <= data.byteLength) {
                const position: [number, number, number] = [
                    view.getFloat32(rodataOffset + 0x00, false),
                    view.getFloat32(rodataOffset + 0x04, false),
                    view.getFloat32(rodataOffset + 0x08, false),
                ];
                const jointPart = rodataOffset + 0x0e <= data.byteLength ? view.getUint16(rodataOffset + 0x0c, false) : -1;
                const joint = jointPart >= 0 ? pose?.[jointPart] : undefined;
                let jointPosition = position;
                if (nodeOffset === rootNode)
                    rootPosition = position;
                if (joint !== undefined) {
                    jointPosition = nodeOffset === rootNode ? [
                        joint.translation[0] * animationScale,
                        joint.translation[1] * animationScale,
                        joint.translation[2] * animationScale,
                    ] : [
                        position[0] + joint.translation[0] * animationScale,
                        position[1] + joint.translation[1] * animationScale,
                        position[2] + joint.translation[2] * animationScale,
                    ];
                    transform = mat4.multiply(mat4.create(), parentTransform, makeModelNodeTransform(joint.rotation, jointPosition, joint.scale));
                } else if (nodeOffset !== rootNode && matrixCount > 1) {
                    mat4.translate(transform, transform, position);
                }

                const matrixIndex0 = view.getInt16(rodataOffset + 0x0e, false);
                const matrixIndex1 = view.getInt16(rodataOffset + 0x10, false);
                const matrixIndex2 = view.getInt16(rodataOffset + 0x12, false);
                if (matrixIndex0 >= 0 && matrixIndex0 < matrixTransforms.length)
                    matrixTransforms[matrixIndex0] = mat4.clone(transform);
                if (joint !== undefined && (nodeType & 0x0100) !== 0 && matrixIndex1 >= 0 && matrixIndex1 < matrixTransforms.length) {
                    const halfTransform = makeHalfRotationModelNodeTransform(joint.rotation, jointPosition);
                    matrixTransforms[matrixIndex1] = mat4.multiply(mat4.create(), parentTransform, halfTransform);
                }
                if (matrixIndex2 >= 0 && matrixIndex2 < matrixTransforms.length)
                    matrixTransforms[matrixIndex2] = mat4.clone(transform);
            } else if (type === 0x0a && rodataOffset + 0x1c <= data.byteLength && bbox === null) {
                bbox = [
                    view.getFloat32(rodataOffset + 0x04, false), view.getFloat32(rodataOffset + 0x08, false),
                    view.getFloat32(rodataOffset + 0x0c, false), view.getFloat32(rodataOffset + 0x10, false),
                    view.getFloat32(rodataOffset + 0x14, false), view.getFloat32(rodataOffset + 0x18, false),
                ];
            } else if ((type === 0x04 || type === 0x18) && rodataOffset + 0x18 <= data.byteLength) {
                const opaque = pointerOffset(view.getUint32(rodataOffset + 0x00, false));
                const translucent = pointerOffset(view.getUint32(rodataOffset + 0x04, false));
                const vertices = pointerOffset(view.getUint32(rodataOffset + 0x0c, false));
                const numVertices = view.getUint16(rodataOffset + 0x10, false);
                displayLists.push({ opaque, translucent, vertices, numVertices, transform: mat4.clone(transform) });
            } else if (type === 0x08 && rodataOffset + 0x0c <= data.byteLength) {
                const near = view.getFloat32(rodataOffset + 0x00, false);
                const far = view.getFloat32(rodataOffset + 0x04, false);
                childOffset = isModelDistanceNodeVisible(near, far, 0)
                    ? pointerOffset(view.getUint32(rodataOffset + 0x08, false))
                    : 0;
            } else if (type === 0x12 && rodataOffset + 4 <= data.byteLength) {
                const part = partByNode.get(nodeOffset);
                childOffset = part !== undefined && hiddenToggleParts?.has(part)
                    ? 0
                    : pointerOffset(view.getUint32(rodataOffset, false));
            }

            const part = partByNode.get(nodeOffset);
            if (part !== undefined)
                partTransforms.set(part, mat4.clone(transform));

            if (childOffset !== 0)
                visit(childOffset, transform);
            nodeOffset = pointerOffset(view.getUint32(nodeOffset + 0x0c, false));
        }
    };

    if (rootNode !== 0)
        visit(rootNode, mat4.create());
    for (const displayList of displayLists) {
        const vertexStride = detectModelVertexStride(data, displayList.opaque, displayList.translucent);
        const colors = (displayList.vertices + displayList.numVertices * vertexStride + 7) & ~7;
        if (displayList.opaque !== 0)
            parseModelDisplayList(builder, data, displayList.opaque, displayList.vertices, colors, displayList.transform, matrixTransforms, false);
        if (displayList.translucent !== 0)
            parseModelDisplayList(builder, data, displayList.translucent, displayList.vertices, colors, displayList.transform, matrixTransforms, true);
    }
    const originOffset: [number, number, number] = [0, 0, 0];
    return {
        vertices: builder.vertices,
        batches: [...builder.batches.values()],
        skeletonId,
        bbox,
        rootPosition,
        originOffset,
        matrixCount,
        partTransforms,
        textureIds: builder.textureIds,
        textureSubcommands: builder.textureSubcommands,
    };
}

function calculatePadCenter(pad: PadData): vec3 {
    const center = vec3.fromValues(pad.position[0], pad.position[1], pad.position[2]);
    vec3.scaleAndAdd(center, center, pad.normal, (pad.bbox[0] + pad.bbox[1]) * 0.5);
    vec3.scaleAndAdd(center, center, pad.up, (pad.bbox[2] + pad.bbox[3]) * 0.5);
    vec3.scaleAndAdd(center, center, pad.look, (pad.bbox[4] + pad.bbox[5]) * 0.5);
    return center;
}

function makeClosedDoorModel(model: ModelGeometry, doorFlags: number, doorType: number): ModelGeometry {
    if ((doorFlags & DOORFLAG_DEFORM) === 0 || model.bbox === null)
        return model;

    const vertical = doorType === DOORTYPE_VERTICAL;
    const boundary = vertical ? Math.ceil(model.bbox[3]) : Math.floor(model.bbox[0]);
    const vertices = model.vertices.map((vertex) => {
        if (vertical ? vertex.y < boundary : vertex.x > boundary)
            return vertex;
        return { ...vertex, ...(vertical ? { y: boundary } : { x: boundary }) };
    });
    return { ...model, vertices };
}

function applyDoorFlip(transform: mat4, doorFlags: number): void {
    if ((doorFlags & DOORFLAG_FLIP) === 0)
        return;
    transform[8] *= -1;
    transform[9] *= -1;
    transform[10] *= -1;
}

function rotatePadForDoor(pad: PadData): PadData {
    const up: [number, number, number] = [...pad.up];
    if ((pad.flags & 0x000e) === 0) {
        up[1] = 0;
        const length = Math.hypot(up[0], up[2]);
        if (length > 0) {
            up[0] /= length;
            up[2] /= length;
        }
    }
    const look: [number, number, number] = [0, 1, 0];
    const normal: [number, number, number] = [
        up[1] * look[2] - look[1] * up[2],
        up[2] * look[0] - look[2] * up[0],
        up[0] * look[1] - look[0] * up[1],
    ];
    return { ...pad, up, look, normal };
}

function findFloorY(triangles: FloorTriangle[] | undefined, x: number, z: number, referenceY: number): number | null {
    if (triangles === undefined)
        return null;

    let bestBelowY: number | null = null;
    for (const triangle of triangles) {
        const [a, b, c] = [triangle.a, triangle.b, triangle.c];
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 0.000001)
            continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.001 || wb < -0.001 || wc < -0.001)
            continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        if (y <= referenceY + 0.001 && (bestBelowY === null || y > bestBelowY))
            bestBelowY = y;
    }
    return bestBelowY;
}

function findFloorYAtCylinder(
    triangles: FloorTriangle[] | undefined,
    x: number,
    z: number,
    referenceY: number,
    radius: number,
): number | null {
    const centerFloorY = findFloorY(triangles, x, z, referenceY);
    if (centerFloorY !== null || triangles === undefined)
        return centerFloorY;

    let bestDistanceSquared = radius * radius + 0.001;
    let bestY: number | null = null;
    for (const triangle of triangles) {
        const vertices = [triangle.a, triangle.b, triangle.c];
        for (let i = 0; i < vertices.length; i++) {
            const start = vertices[i];
            const end = vertices[(i + 1) % vertices.length];
            const dx = end[0] - start[0];
            const dz = end[2] - start[2];
            const lengthSquared = dx * dx + dz * dz;
            const amount = lengthSquared > 0
                ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (z - start[2]) * dz) / lengthSquared))
                : 0;
            const closestX = start[0] + dx * amount;
            const closestZ = start[2] + dz * amount;
            const distanceSquared = (x - closestX) ** 2 + (z - closestZ) ** 2;
            const y = start[1] + (end[1] - start[1]) * amount;
            if (y > referenceY + 0.001 || distanceSquared > bestDistanceSquared + 0.001)
                continue;
            if (distanceSquared < bestDistanceSquared - 0.001 || bestY === null || y > bestY) {
                bestDistanceSquared = distanceSquared;
                bestY = y;
            }
        }
    }
    return bestY;
}

function findFloorAcrossRoomsAtCylinder(
    trianglesByRoom: Map<number, FloorTriangle[]>,
    authoredRoom: number,
    x: number,
    z: number,
    referenceY: number,
    radius: number,
): { room: number; y: number } | null {
    let best: { room: number; y: number } | null = null;
    for (const [room, triangles] of trianglesByRoom) {
        if (room === authoredRoom)
            continue;
        const y = findFloorYAtCylinder(triangles, x, z, referenceY, radius);
        if (y !== null && (best === null || y > best.y))
            best = { room, y };
    }
    return best;
}

function findNearestSurfaceY(triangles: FloorTriangle[], x: number, z: number, referenceY: number): number | null {
    let bestY: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const triangle of triangles) {
        const [a, b, c] = [triangle.a, triangle.b, triangle.c];
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 0.000001)
            continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.001 || wb < -0.001 || wc < -0.001)
            continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        const distance = Math.abs(y - referenceY);
        if (distance < bestDistance) {
            bestY = y;
            bestDistance = distance;
        }
    }
    return bestY;
}

function resolvePadRoom(pad: PadData, floorTrianglesByRoom: Map<number, FloorTriangle[]>, roomBoundsByRoom: Map<number, RoomBounds>): PadData {
    if (pad.room > 0)
        return pad;

    let bestRoom = pad.room;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [room, bounds] of roomBoundsByRoom) {
        const tolerance = 32;
        if (pad.position[0] < bounds.min[0] - tolerance || pad.position[0] > bounds.max[0] + tolerance
                || pad.position[1] < bounds.min[1] - tolerance || pad.position[1] > bounds.max[1] + tolerance
                || pad.position[2] < bounds.min[2] - tolerance || pad.position[2] > bounds.max[2] + tolerance)
            continue;
        const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
        const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
        const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
        const distance = Math.hypot(pad.position[0] - centerX, pad.position[1] - centerY, pad.position[2] - centerZ);
        if (distance < bestDistance) {
            bestRoom = room;
            bestDistance = distance;
        }
    }
    if (bestRoom > 0)
        return { ...pad, room: bestRoom };

    for (const [room, triangles] of floorTrianglesByRoom) {
        const floorY = findNearestSurfaceY(triangles, pad.position[0], pad.position[2], pad.position[1]);
        if (floorY === null)
            continue;
        const distance = Math.abs(floorY - pad.position[1]);
        if (distance < bestDistance) {
            bestRoom = room;
            bestDistance = distance;
        }
    }
    return bestRoom === pad.room ? pad : { ...pad, room: bestRoom };
}

interface ObjectCollider {
    commandIndex: number | null;
    room: number;
    polygon: [number, number][];
    xmin: number;
    xmax: number;
    ymin: number;
    ymax: number;
    zmin: number;
    zmax: number;
}

interface ObjectPlacement {
    transform: mat4;
    collider: ObjectCollider | null;
    onAnotherObject: boolean;
    supportCommandIndex: number | null;
    placementMode: "door" | "wall-mounted" | "upside-down" | "fixed-bottom" | "room-floor" | "object-support" | "authored-pad-floor" | "character-attachment" | "title-sequence" | "gallery-pad";
    placementPosition: [number, number, number];
    floorQueryPosition: [number, number, number] | null;
    placementContactY: number | null;
    placementBounds: [number, number, number, number, number, number];
    surfaceY: number | null;
}

function pointInPolygon(polygon: [number, number][], x: number, z: number): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i];
        const [xj, zj] = polygon[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi)
            inside = !inside;
    }
    return inside;
}

function makeObjectCollider(bbox: [number, number, number, number, number, number], transform: mat4, room: number): ObjectCollider {
    const points: [number, number][] = [];
    let xmin = Number.POSITIVE_INFINITY;
    let xmax = Number.NEGATIVE_INFINITY;
    let ymin = Number.POSITIVE_INFINITY;
    let ymax = Number.NEGATIVE_INFINITY;
    let zmin = Number.POSITIVE_INFINITY;
    let zmax = Number.NEGATIVE_INFINITY;
    const point = vec3.create();
    for (const x of [bbox[0], bbox[1]]) {
        for (const y of [bbox[2], bbox[3]]) {
            for (const z of [bbox[4], bbox[5]]) {
                vec3.transformMat4(point, [x, y, z], transform);
                points.push([point[0], point[2]]);
                xmin = Math.min(xmin, point[0]);
                xmax = Math.max(xmax, point[0]);
                ymin = Math.min(ymin, point[1]);
                ymax = Math.max(ymax, point[1]);
                zmin = Math.min(zmin, point[2]);
                zmax = Math.max(zmax, point[2]);
            }
        }
    }

    const unique = [...new Map(points.map((value) => [`${value[0].toFixed(5)}:${value[1].toFixed(5)}`, value])).values()]
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [];
    for (const value of unique) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], value) <= 0)
            lower.pop();
        lower.push(value);
    }
    const upper: [number, number][] = [];
    for (let i = unique.length - 1; i >= 0; i--) {
        const value = unique[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], value) <= 0)
            upper.pop();
        upper.push(value);
    }
    lower.pop();
    upper.pop();
    return { commandIndex: null, room, polygon: lower.concat(upper), xmin, xmax, ymin, ymax, zmin, zmax };
}

function makeObjectPlacement(
    pad: PadData,
    model: ModelGeometry,
    baseScale: number,
    extraScale: number,
    flags: number,
    door: boolean,
    floorTriangles?: FloorTriangle[],
    activeObjects: ObjectCollider[] = [],
    objectType = 0x03,
    flags3 = 0,
): ObjectPlacement {
    const bbox = model.bbox ?? [-50, 50, -50, 50, -50, 50];
    const modelSize = [bbox[1] - bbox[0], bbox[3] - bbox[2], bbox[5] - bbox[4]];
    const padSize = [pad.bbox[1] - pad.bbox[0], pad.bbox[3] - pad.bbox[2], pad.bbox[5] - pad.bbox[4]];
    const scaleMultiplier = extraScale / 256;
    let scale: [number, number, number];
    let xAxis: [number, number, number];
    let yAxis: [number, number, number];
    let zAxis: [number, number, number];
    let position: vec3;
    let onAnotherObject = false;
    let supportCommandIndex: number | null = null;
    let placementMode: ObjectPlacement["placementMode"] = "authored-pad-floor";
    let floorQueryPosition: [number, number, number] | null = null;
    let placementContactY: number | null = null;
    let surfaceY: number | null = null;

    if (door) {
        placementMode = "door";
        scale = [padSize[1] / modelSize[0], padSize[2] / modelSize[1], padSize[0] / modelSize[2]];
        if (scale.some((value) => !Number.isFinite(value) || value <= 0.000001))
            scale = [1, 1, 1];
        scale = [scale[0] * baseScale, scale[1] * baseScale, scale[2] * baseScale];
        xAxis = pad.up;
        yAxis = pad.look;
        zAxis = pad.normal;
        position = calculatePadCenter(pad);
    } else {
        scale = [baseScale, baseScale, baseScale];
        const rotated = (flags & 0x02) !== 0;
        if (pad.hasBbox && flags & 0x20 && modelSize[0] > 0)
            scale[0] = padSize[0] / modelSize[0];
        if (pad.hasBbox && flags & 0x40 && modelSize[1] > 0)
            scale[1] = (rotated ? padSize[2] : padSize[1]) / modelSize[1];
        if (pad.hasBbox && flags & 0x80 && modelSize[2] > 0)
            scale[2] = (rotated ? padSize[1] : padSize[2]) / modelSize[2];
        scale = [scale[0] * scaleMultiplier, scale[1] * scaleMultiplier, scale[2] * scaleMultiplier];
        xAxis = rotated ? [-pad.normal[0], -pad.normal[1], -pad.normal[2]] : pad.normal;
        yAxis = rotated ? pad.look : pad.up;
        zAxis = rotated ? pad.up : pad.look;
        position = pad.hasBbox ? calculatePadCenter(pad) : vec3.fromValues(...pad.position);
        if (pad.hasBbox)
            vec3.scaleAndAdd(position, position, pad.up, (pad.bbox[2] - pad.bbox[3]) * 0.5);

        if (rotated) {
            placementMode = "wall-mounted";
            vec3.scaleAndAdd(position, position, zAxis, -bbox[4] * scale[2]);
        } else if (flags & 0x04) {
            placementMode = "upside-down";
            xAxis = [-xAxis[0], -xAxis[1], -xAxis[2]];
            yAxis = [-yAxis[0], -yAxis[1], -yAxis[2]];
            vec3.scaleAndAdd(position, position, yAxis, -bbox[3] * scale[1]);
        } else if (flags & 0x08) {
            placementMode = "fixed-bottom";
            vec3.scaleAndAdd(position, position, yAxis, -bbox[2] * scale[1]);
        } else {
            const axes = [xAxis, yAxis, zAxis];
            const mins = [bbox[0], bbox[2], bbox[4]];
            const maxs = [bbox[1], bbox[3], bbox[5]];
            let verticalAxis = 0;
            for (let i = 1; i < 3; i++) {
                if (Math.abs(axes[i][1] * scale[i]) > Math.abs(axes[verticalAxis][1] * scale[verticalAxis]))
                    verticalAxis = i;
            }
            const localExtent = axes[verticalAxis][1] < 0 ? maxs[verticalAxis] : mins[verticalAxis];
            const contactOffsetY = localExtent * axes[verticalAxis][1] * scale[verticalAxis];
            vec3.scaleAndAdd(position, position, axes[verticalAxis], -localExtent * scale[verticalAxis]);
            floorQueryPosition = [position[0], position[1], position[2]];
            const floorY = findFloorY(floorTriangles, position[0], position[2], position[1]);
            if (floorY !== null) {
                surfaceY = floorY;
                const clearance = objectType === OBJTYPE_WEAPON ? 0 : 4;
                const height = (maxs[verticalAxis] - mins[verticalAxis]) * Math.abs(axes[verticalAxis][1] * scale[verticalAxis]);
                const support = activeObjects.find((collider) => collider.room === pad.room
                    && pointInPolygon(collider.polygon, position[0], position[2]));
                if (support !== undefined && support.ymax > floorY && support.ymin < floorY + height + clearance) {
                    position[1] = support.ymax - localExtent * axes[verticalAxis][1] * scale[verticalAxis];
                    onAnotherObject = true;
                    supportCommandIndex = support.commandIndex;
                    placementMode = "object-support";
                    surfaceY = support.ymax;
                } else {
                    position[1] = floorY - localExtent * axes[verticalAxis][1] * scale[verticalAxis] + clearance;
                    placementMode = "room-floor";
                }
            }
            placementContactY = position[1] + contactOffsetY;
        }
    }

    const baseTransform = mat4.fromValues(
        xAxis[0] * scale[0], xAxis[1] * scale[0], xAxis[2] * scale[0], 0,
        yAxis[0] * scale[1], yAxis[1] * scale[1], yAxis[2] * scale[1], 0,
        zAxis[0] * scale[2], zAxis[1] * scale[2], zAxis[2] * scale[2], 0,
        position[0], position[1], position[2], 1,
    );
    const placementBox = makeObjectCollider(bbox, baseTransform, pad.room);
    const collider = !door && model.bbox !== null && (flags & OBJFLAG_CORE_GEO_INUSE) !== 0
            && (flags3 & (OBJFLAG3_WALKTHROUGH | OBJFLAG3_GEOCYL)) === 0
        ? placementBox : null;
    const transform = mat4.clone(baseTransform);
    mat4.translate(transform, transform, [-model.originOffset[0], -model.originOffset[1], -model.originOffset[2]]);
    return {
        transform,
        collider,
        onAnotherObject,
        supportCommandIndex,
        placementMode,
        placementPosition: [position[0], position[1], position[2]],
        floorQueryPosition,
        placementContactY,
        placementBounds: [placementBox.xmin, placementBox.xmax, placementBox.ymin, placementBox.ymax, placementBox.zmin, placementBox.zmax],
        surfaceY,
    };
}

function makeObjectTransform(
    pad: PadData,
    model: ModelGeometry,
    baseScale: number,
    extraScale: number,
    flags: number,
    door: boolean,
    floorTriangles?: FloorTriangle[],
): mat4 {
    return makeObjectPlacement(pad, model, baseScale, extraScale, flags, door, floorTriangles).transform;
}

function makeAnimatedObjectTransform(position: [number, number, number], rotation: [number, number, number], model: ModelGeometry, scale: number): mat4 {
    const [x, y, z] = rotation;
    const xcos = Math.cos(x);
    const xsin = Math.sin(x);
    const ycos = Math.cos(y);
    const ysin = Math.sin(y);
    const zcos = Math.cos(z);
    const zsin = Math.sin(z);
    const a = xsin * zsin;
    const b = xcos * zsin;
    const c = xsin * zcos;
    const d = xcos * zcos;

    const transform = mat4.fromValues(
        ycos * zcos * scale, ycos * zsin * scale, -ysin * scale, 0,
        (c * ysin - xcos * zsin) * scale, (a * ysin + xcos * zcos) * scale, xsin * ycos * scale, 0,
        (d * ysin + xsin * zsin) * scale, (b * ysin - xsin * zcos) * scale, xcos * ycos * scale, 0,
        position[0], position[1], position[2], 1,
    );
    mat4.translate(transform, transform, [-model.originOffset[0], -model.originOffset[1], -model.originOffset[2]]);
    return transform;
}

function makeCharacterTransform(pad: PadData, scale: number, surfaceY: number | null): mat4 {
    const angle = Math.atan2(pad.look[0], pad.look[2]);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return mat4.fromValues(
        cosine * scale, 0, -sine * scale, 0,
        0, scale, 0, 0,
        sine * scale, 0, cosine * scale, 0,
        pad.position[0], surfaceY === null ? pad.position[1] : surfaceY + 100, pad.position[2],
        1,
    );
}

function makeAttachedObjectTransform(character: CharacterPlacement, partTransform: mat4, model: ModelGeometry, scale: number): mat4 {
    const transform = mat4.multiply(mat4.create(), character.transform, partTransform);
    for (let column = 0; column < 3; column++) {
        const offs = column * 4;
        const length = Math.hypot(transform[offs], transform[offs + 1], transform[offs + 2]);
        if (length > 0.000001) {
            transform[offs] = transform[offs] / length * scale;
            transform[offs + 1] = transform[offs + 1] / length * scale;
            transform[offs + 2] = transform[offs + 2] / length * scale;
        }
    }
    mat4.translate(transform, transform, [-model.originOffset[0], -model.originOffset[1], -model.originOffset[2]]);
    return transform;
}

const titleSequenceTransforms: { position: [number, number, number]; rotation: [number, number, number] }[] = [
    { position: [-26.267, 21.955, -15.840], rotation: [0, 0, 0] },
    { position: [-8.3395, 33.887, -88.1215], rotation: [0.332873831, 0.319068004, 0] },
    { position: [-9.859, 10.001, -23.5295], rotation: [0, 0.362019466, 0] },
];

interface ConvertedStageObjects {
    data: Buffer | null;
    textureIds: Set<number>;
    textureSubcommands: Set<number>;
    objectCount: number;
    doorCount: number;
    openDoorCount: number;
    stackedObjectCount: number;
    characterCount: number;
    skippedCount: number;
    excludedCount: number;
    commandCount: number;
    padCount: number;
    syntheticPadCount: number;
    syntheticObjectCount: number;
    unresolvedPadRoomCount: number;
    navigation: NavigationAudit;
    skippedReasons: Map<string, number>;
    excludedReasons: Map<string, number>;
    includedTypes: Map<number, number>;
    characterPlacements: {
        commandIndex: number;
        characterId: number;
        bodyNum: number;
        packedHeadNum: number;
        headNum: number;
        spawnFlags: number;
        sunglasses: boolean;
        hasEmbeddedHead: boolean;
        skeletonId: number;
        matrixCount: number;
        padNum: number;
        padPosition: [number, number, number] | null;
        padUp: [number, number, number];
        room: number;
        placementMode: "collision-floor" | "nearby-room-collision-floor" | "background-floor" | "nearby-room-background-floor" | "authored-pad-floor" | "gallery-pad";
        floorQueryPosition: [number, number, number];
        placementOriginY: number;
        placementContactY: number;
        surfaceY: number | null;
        surfaceRoom: number | null;
        headSocketY: number | null;
        rootPosition: [number, number, number];
        worldBounds: [number, number, number, number, number, number];
        rootAdjustedWorldBounds: [number, number, number, number, number, number];
    }[];
    objectPlacements: {
        commandIndex: number;
        type: number;
        modelNum: number;
        padNum: number;
        padPosition: [number, number, number];
        room: number;
        flags: number;
        flags2: number;
        flags3: number;
        doorFlags: number | null;
        doorType: number | null;
        hidden: number;
        onAnotherObject: boolean;
        supportCommandIndex: number | null;
        placementMode: ObjectPlacement["placementMode"];
        placementPosition: [number, number, number];
        floorQueryPosition: [number, number, number] | null;
        placementContactY: number | null;
        placementBounds: [number, number, number, number, number, number];
        surfaceY: number | null;
        matrixCount: number;
        rootPosition: [number, number, number];
        originOffset: [number, number, number];
        modelBbox: [number, number, number, number, number, number] | null;
        modelBounds: [number, number, number, number, number, number];
        translation: [number, number, number];
        worldBounds: [number, number, number, number, number, number];
    }[];
    unresolvedRooms: { commandIndex: number; type: number; padNum: number; position: [number, number, number]; encodedRoom: number }[];
}

interface PlacementValidation {
    status: "passed";
    checkedCount: number;
    modes: Record<ObjectPlacement["placementMode"], number>;
    maximumSurfaceError: number;
    outsideBackgroundCount: number;
    outsideBackgroundModes: Record<ObjectPlacement["placementMode"], number>;
}

interface CharacterValidation {
    status: "passed";
    checkedCount: number;
    groundedCount: number;
    authoredPadFallbackCount: number;
    galleryPadCount: number;
    maximumWalkingMeshContactOffset: number;
    maximumGalleryPadContactOffset: number;
    maximumRootPlacementError: number;
    uprightHumanCount: number;
    randomHeadCount: number;
    distinctRandomHeadCount: number;
    sunglassesCount: number;
    forcedSunglassesCount: number;
    optionalSunglassesCount: number;
    modes: Record<ConvertedStageObjects["characterPlacements"][number]["placementMode"], number>;
    skeletonCounts: Record<string, number>;
}

function validateCharacterPlacements(stageId: string, placements: ConvertedStageObjects["characterPlacements"]): CharacterValidation {
    let groundedCount = 0;
    let authoredPadFallbackCount = 0;
    let galleryPadCount = 0;
    let maximumWalkingMeshContactOffset = 0;
    let maximumGalleryPadContactOffset = 0;
    let maximumRootPlacementError = 0;
    let uprightHumanCount = 0;
    let randomHeadCount = 0;
    let sunglassesCount = 0;
    let forcedSunglassesCount = 0;
    let optionalSunglassesCount = 0;
    const randomHeads = new Set<number>();
    const modes: CharacterValidation["modes"] = {
        "collision-floor": 0,
        "nearby-room-collision-floor": 0,
        "background-floor": 0,
        "nearby-room-background-floor": 0,
        "authored-pad-floor": 0,
        "gallery-pad": 0,
    };
    const skeletonCounts = new Map<number, number>();

    for (const placement of placements) {
        if (placement.packedHeadNum < 0 && !placement.hasEmbeddedHead) {
            randomHeadCount++;
            randomHeads.add(placement.headNum);
        }
        if ((placement.spawnFlags & SPAWNFLAG_FORCESUNGLASSES) !== 0) {
            forcedSunglassesCount++;
            if (!placement.sunglasses)
                throw new Error(`${stageId} character command ${placement.commandIndex} did not render forced sunglasses`);
        } else if ((placement.spawnFlags & SPAWNFLAG_MAYBESUNGLASSES) !== 0) {
            optionalSunglassesCount++;
        } else if (placement.sunglasses) {
            throw new Error(`${stageId} character command ${placement.commandIndex} rendered unrequested sunglasses`);
        }
        if (placement.sunglasses)
            sunglassesCount++;
        const values = [...placement.worldBounds, ...placement.rootAdjustedWorldBounds, ...placement.rootPosition,
            ...placement.padUp, ...placement.floorQueryPosition, placement.placementOriginY, placement.placementContactY];
        if (placement.padPosition !== null)
            values.push(...placement.padPosition);
        if (placement.surfaceY !== null)
            values.push(placement.surfaceY);
        if (placement.headSocketY !== null)
            values.push(placement.headSocketY);
        if (!values.every(Number.isFinite))
            throw new Error(`${stageId} character command ${placement.commandIndex} has non-finite placement evidence`);
        if (placement.worldBounds[0] > placement.worldBounds[1]
                || placement.worldBounds[2] > placement.worldBounds[3]
                || placement.worldBounds[4] > placement.worldBounds[5]) {
            throw new Error(`${stageId} character command ${placement.commandIndex} has inverted world bounds`);
        }

        skeletonCounts.set(placement.skeletonId, (skeletonCounts.get(placement.skeletonId) ?? 0) + 1);
        modes[placement.placementMode]++;
        if (placement.placementMode === "gallery-pad") {
            const padError = Math.abs(placement.placementContactY);
            maximumGalleryPadContactOffset = Math.max(maximumGalleryPadContactOffset, padError);
            galleryPadCount++;
            groundedCount++;
            if (padError > 0.05)
                throw new Error(`${stageId} character command ${placement.commandIndex} is ${padError.toFixed(3)} units from its gallery pad`);
        } else if (placement.surfaceY !== null) {
            const rootError = Math.abs(placement.placementOriginY - (placement.surfaceY + 100));
            maximumRootPlacementError = Math.max(maximumRootPlacementError, rootError);
            groundedCount++;
            if (rootError > 0.05)
                throw new Error(`${stageId} character command ${placement.commandIndex} places its root ${rootError.toFixed(3)} units from the game's collision-floor offset`);

            if (placement.skeletonId === HUMAN_SKELETON_ID || placement.skeletonId === SKEDAR_SKELETON_ID) {
                const floorError = Math.abs(placement.placementContactY - placement.surfaceY);
                maximumWalkingMeshContactOffset = Math.max(maximumWalkingMeshContactOffset, floorError);
            }
        } else {
            authoredPadFallbackCount++;
        }

        if (placement.skeletonId === HUMAN_SKELETON_ID) {
            if (placement.headSocketY === null && !placement.hasEmbeddedHead)
                throw new Error(`${stageId} character command ${placement.commandIndex} has no human head socket`);
            const headHeight = placement.headSocketY === null
                ? placement.worldBounds[3] - placement.worldBounds[2]
                : placement.headSocketY - placement.placementContactY;
            if (headHeight < 50)
                throw new Error(`${stageId} character command ${placement.commandIndex} body 0x${placement.bodyNum.toString(16)} has a non-upright human pose (head height ${headHeight.toFixed(3)})`);
            uprightHumanCount++;
        }
    }

    return {
        status: "passed",
        checkedCount: placements.length,
        groundedCount,
        authoredPadFallbackCount,
        galleryPadCount,
        maximumWalkingMeshContactOffset,
        maximumGalleryPadContactOffset,
        maximumRootPlacementError,
        uprightHumanCount,
        randomHeadCount,
        distinctRandomHeadCount: randomHeads.size,
        sunglassesCount,
        forcedSunglassesCount,
        optionalSunglassesCount,
        modes,
        skeletonCounts: Object.fromEntries([...skeletonCounts]
            .sort(([a], [b]) => a - b)
            .map(([skeletonId, count]) => [`0x${skeletonId.toString(16).padStart(2, "0")}`, count])),
    };
}

function validateObjectPlacements(
    stageId: string,
    placements: ConvertedStageObjects["objectPlacements"],
    roomBoundsByRoom: Map<number, RoomBounds>,
): PlacementValidation {
    const emptyModeCounts = (): PlacementValidation["modes"] => ({
        "door": 0,
        "wall-mounted": 0,
        "upside-down": 0,
        "fixed-bottom": 0,
        "room-floor": 0,
        "object-support": 0,
        "authored-pad-floor": 0,
        "character-attachment": 0,
        "title-sequence": 0,
        "gallery-pad": 0,
    });
    const modes = emptyModeCounts();
    const outsideBackgroundModes = emptyModeCounts();
    let maximumSurfaceError = 0;
    let outsideBackgroundCount = 0;
    const fail = (placement: ConvertedStageObjects["objectPlacements"][number], reason: string): never => {
        throw new Error(`${stageId} object command ${placement.commandIndex} (type 0x${placement.type.toString(16)}, model ${placement.modelNum}, pad ${placement.padNum}, room ${placement.room}) failed placement validation: ${reason}`);
    };
    const finiteBounds = (bounds: [number, number, number, number, number, number]): boolean =>
        bounds.every(Number.isFinite) && bounds[0] <= bounds[1] && bounds[2] <= bounds[3] && bounds[4] <= bounds[5];
    const intersects = (a: [number, number, number, number, number, number], b: RoomBounds): boolean =>
        a[1] >= b.min[0] && a[0] <= b.max[0]
        && a[3] >= b.min[1] && a[2] <= b.max[1]
        && a[5] >= b.min[2] && a[4] <= b.max[2];

    for (const placement of placements) {
        modes[placement.placementMode]++;
        if (![...(placement.padPosition ?? []), ...placement.placementPosition, ...placement.translation].every(Number.isFinite))
            fail(placement, "non-finite position or translation");
        if (!finiteBounds(placement.placementBounds) || !finiteBounds(placement.worldBounds))
            fail(placement, "non-finite or inverted bounds");
        if (roomBoundsByRoom.size > 0 && ![...roomBoundsByRoom.values()].some((bounds) => intersects(placement.worldBounds, bounds))) {
            outsideBackgroundCount++;
            outsideBackgroundModes[placement.placementMode]++;
        }

        const grounded = placement.placementMode === "room-floor"
            || placement.placementMode === "object-support"
            || placement.placementMode === "authored-pad-floor"
            || placement.placementMode === "gallery-pad";
        if (grounded !== (placement.floorQueryPosition !== null))
            fail(placement, "floor-query evidence does not match placement mode");
        if (grounded !== (placement.placementContactY !== null))
            fail(placement, "contact-point evidence does not match placement mode");

        let expectedBottom: number | null = null;
        if (placement.placementMode === "room-floor") {
            if (placement.surfaceY === null)
                fail(placement, "room-floor placement has no collision surface");
            expectedBottom = placement.surfaceY + (placement.type === OBJTYPE_WEAPON ? 0 : 4);
        } else if (placement.placementMode === "object-support") {
            if (placement.surfaceY === null || placement.supportCommandIndex === null)
                fail(placement, "object-support placement has no support evidence");
            if (placement.supportCommandIndex >= placement.commandIndex)
                fail(placement, "object-support placement references a later setup command");
            expectedBottom = placement.surfaceY;
        } else if (placement.placementMode === "authored-pad-floor") {
            if (placement.surfaceY !== null || placement.floorQueryPosition === null)
                fail(placement, "authored-pad placement has inconsistent floor evidence");
        } else if (placement.placementMode === "gallery-pad") {
            if (placement.surfaceY !== null || placement.floorQueryPosition === null)
                fail(placement, "gallery-pad placement has inconsistent floor evidence");
            expectedBottom = 0;
        } else if (placement.surfaceY !== null || placement.supportCommandIndex !== null) {
            fail(placement, "non-grounded placement unexpectedly has support evidence");
        }

        if (expectedBottom !== null) {
            const error = Math.abs(placement.placementContactY! - expectedBottom);
            maximumSurfaceError = Math.max(maximumSurfaceError, error);
            if (error > 0.05)
                fail(placement, `${placement.placementMode} contact ${placement.placementContactY!.toFixed(3)} is ${error.toFixed(3)} units from expected ${expectedBottom.toFixed(3)} (query ${placement.floorQueryPosition?.join(",") ?? "none"})`);
        }
    }

    return { status: "passed", checkedCount: placements.length, modes, maximumSurfaceError, outsideBackgroundCount, outsideBackgroundModes };
}

interface SetupCommand {
    index: number;
    offset: number;
    type: number;
    length: number;
}

interface CharacterPlacement {
    transform: mat4;
    model: ModelGeometry;
    room: number;
}

function convertStageObjects(
    rom: Uint8Array,
    dataView: DataView,
    version: RomVersion,
    stage: StageExtraction,
    stageEntry: StageTableEntry,
    modelStates: { fileId: number; scale: number }[],
    headBodyStates: HeadBodyState[],
    characterPoses: ReadonlyMap<number, AnimationPose>,
    modelCache: Map<number, ModelGeometry>,
    objectGalleryCatalog: ObjectGalleryCatalog,
    floorTrianglesByRoom: Map<number, FloorTriangle[]>,
    roomBoundsByRoom: Map<number, RoomBounds>,
    padRecoveryTrianglesByRoom: Map<number, FloorTriangle[]>,
): ConvertedStageObjects {
    const setupFileId = stage.multiplayer ? stageEntry.multiplayerSetupFileId : stageEntry.setupFileId;
    const setup = readRomFile(rom, dataView, version.fileTableOffset, setupFileId);
    const setupView = new DataView(setup.buffer, setup.byteOffset, setup.byteLength);
    const propsOffset = setupView.getUint32(0x10, false);
    const padsFile = stage.titleSequence ? null : readRomFile(rom, dataView, version.fileTableOffset, stageEntry.padsFileId);
    const parsedPads = padsFile === null ? [] : parsePads(padsFile);
    for (let i = 0; i < parsedPads.length; i++) {
        const pad = parsedPads[i];
        const values = [...pad.position, ...pad.look, ...pad.up, ...pad.normal, ...pad.bbox];
        if (!values.every(Number.isFinite))
            throw new Error(`${stage.id} pad ${i} contains a non-finite coordinate`);
        if (Math.hypot(...pad.look) < 0.000001 || Math.hypot(...pad.up) < 0.000001 || Math.hypot(...pad.normal) < 0.000001)
            throw new Error(`${stage.id} pad ${i} has a degenerate basis`);
    }
    const pads = parsedPads.map((pad) => {
        const collisionResolved = resolvePadRoom(pad, floorTrianglesByRoom, roomBoundsByRoom);
        return collisionResolved.room > 0
            ? collisionResolved
            : resolvePadRoom(collisionResolved, padRecoveryTrianglesByRoom, roomBoundsByRoom);
    });
    const unresolvedPadRoomCount = pads.filter((pad) => pad.room <= 0).length;
    const navigation = padsFile === null
        ? { waypointCount: 0, waypointEdgeCount: 0, waygroupCount: 0, waygroupEdgeCount: 0, unresolvedWaypointPadRoomCount: 0 }
        : validatePadNavigation(padsFile, pads);
    if (propsOffset <= 0 || propsOffset >= setup.byteLength)
        throw new Error(`${stage.id} setup has an invalid props offset 0x${propsOffset.toString(16)}`);

    const builder = new GeometryBuilder();
    let objectCount = 0;
    let doorCount = 0;
    let openDoorCount = 0;
    let stackedObjectCount = 0;
    let characterCount = 0;
    let skippedCount = 0;
    let excludedCount = 0;
    let titleObjectIndex = 0;
    let offs = propsOffset;
    let foundEnd = false;
    const commands: SetupCommand[] = [];
    const skippedReasons = new Map<string, number>();
    const excludedReasons = new Map<string, number>();
    const includedTypes = new Map<number, number>();
    const charactersById = new Map<number, CharacterPlacement>();
    const activeObjects: ObjectCollider[] = [];
    const characterPlacements: ConvertedStageObjects["characterPlacements"] = [];
    const objectPlacements: ConvertedStageObjects["objectPlacements"] = [];
    const unresolvedRooms: ConvertedStageObjects["unresolvedRooms"] = [];
    const activeHeadCount = stage.multiplayer ? 4
        : stage.id === "infiltration" || stage.id === "escape" ? 5
        : stage.id === "rescue" ? 4
        : 8;
    const activeMaleHeads = makeDeterministicHeadPool(stage.id, "male", MALE_GUARD_HEADS, activeHeadCount);
    const activeFemaleHeads = makeDeterministicHeadPool(stage.id, "female", FEMALE_GUARD_HEADS, activeHeadCount);
    const activeFemGuardHeads = makeDeterministicHeadPool(stage.id, "female-guard", FEM_GUARD_HEADS, FEM_GUARD_HEADS.length);
    let activeMaleHeadIndex = 0;
    let activeFemaleHeadIndex = 0;
    let activeFemGuardHeadIndex = 0;
    const bump = (counts: Map<string, number>, reason: string): void => {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
    };
    const getModel = (modelState: { fileId: number; scale: number }): ModelGeometry => {
        let model = modelCache.get(modelState.fileId);
        if (model === undefined) {
            model = parseModel(readRomFile(rom, dataView, version.fileTableOffset, modelState.fileId));
            modelCache.set(modelState.fileId, model);
        }
        return model;
    };
    const appendModel = (model: ModelGeometry, transform: mat4): void => {
        builder.appendModel(model, transform);
        for (const textureId of model.textureIds)
            builder.textureIds.add(textureId);
        for (const textureSubcommand of model.textureSubcommands)
            builder.textureSubcommands.add(textureSubcommand);
    };
    const getCharacterBody = (bodyState: HeadBodyState): ModelGeometry => {
        const cacheKey = 0x10000 | bodyState.fileId;
        let body = modelCache.get(cacheKey);
        if (body === undefined) {
            body = parseModel(
                readRomFile(rom, dataView, version.fileTableOffset, bodyState.fileId),
                characterPoses,
                bodyState.animationScale,
            );
            modelCache.set(cacheKey, body);
        }
        return body;
    };
    const chooseRandomHead = (bodyNum: number, bodyState: HeadBodyState): number => {
        if (bodyState.isMale)
            return activeMaleHeads[activeMaleHeadIndex++ % activeMaleHeads.length];
        if (bodyNum === BODY_FEM_GUARD)
            return activeFemGuardHeads[activeFemGuardHeadIndex++ % activeFemGuardHeads.length];
        return activeFemaleHeads[activeFemaleHeadIndex++ % activeFemaleHeads.length];
    };
    const appendCharacterHead = (
        bodyState: HeadBodyState,
        body: ModelGeometry,
        transform: mat4,
        headNum: number,
        sunglasses: boolean,
    ): number | null => {
        const headTransform = body.skeletonId === HUMAN_SKELETON_ID
            ? body.partTransforms.get(CHARACTER_HEAD_PART)
            : undefined;
        if (headTransform === undefined)
            return null;
        const headSocket = vec3.transformMat4(vec3.create(), [0, 0, 0], mat4.multiply(mat4.create(), transform, headTransform));
        const headState = headBodyStates[headNum];
        if (!bodyState.hasEmbeddedHead && headState !== undefined && headState.fileId !== 0) {
            const cacheKey = (sunglasses ? 0x30000 : 0x20000) | headState.fileId;
            let head = modelCache.get(cacheKey);
            if (head === undefined) {
                const hiddenToggleParts = new Set([HEAD_PART_EYES_CLOSED, HEAD_PART_HUD_PIECE]);
                if (!sunglasses)
                    hiddenToggleParts.add(HEAD_PART_SUNGLASSES);
                head = parseModel(
                    readRomFile(rom, dataView, version.fileTableOffset, headState.fileId),
                    null,
                    1,
                    hiddenToggleParts,
                );
                modelCache.set(cacheKey, head);
            }
            if (head.vertices.length > 0)
                appendModel(head, mat4.multiply(mat4.create(), transform, headTransform));
        }
        return headSocket[1];
    };
    const transformBounds = (model: ModelGeometry, transform: mat4): [number, number, number, number, number, number] => {
        const bounds: [number, number, number, number, number, number] = [
            Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
            Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
        ];
        const point = vec3.create();
        for (const vertex of model.vertices) {
            vec3.transformMat4(point, [vertex.x, vertex.y, vertex.z], transform);
            bounds[0] = Math.min(bounds[0], point[0]);
            bounds[1] = Math.max(bounds[1], point[0]);
            bounds[2] = Math.min(bounds[2], point[1]);
            bounds[3] = Math.max(bounds[3], point[1]);
            bounds[4] = Math.min(bounds[4], point[2]);
            bounds[5] = Math.max(bounds[5], point[2]);
        }
        return bounds;
    };

    for (let commandIndex = 0; commandIndex < 0x10000; commandIndex++) {
        if (offs + 4 > setup.byteLength)
            throw new Error(`${stage.id} setup command ${commandIndex} points outside its file`);
        const word0 = setupView.getUint32(offs, false);
        const type = word0 & 0xff;
        if (type === 0x34) {
            foundEnd = true;
            break;
        }
        const length = setupCommandLengths.get(type);
        if (length === undefined || offs + length * 4 > setup.byteLength)
            throw new Error(`${stage.id} setup has invalid command 0x${type.toString(16)} at 0x${offs.toString(16)}`);

        commands.push({ index: commandIndex, offset: offs, type, length });
        offs += length * 4;
    }

    if (!foundEnd)
        throw new Error(`${stage.id} setup has no end command`);

    const conditionallyHidden = new Set<number>();
    for (const command of commands) {
        if (command.type !== OBJTYPE_CONDITIONALSCENERY)
            continue;
        const explodedOffset = setupView.getInt32(command.offset + 0x0c, false);
        if (explodedOffset !== 0)
            conditionallyHidden.add(command.index + explodedOffset);
    }

    let doorScale = 1;
    for (const command of commands) {
        const { index: commandIndex, offset: offs, type } = command;
        const word0 = setupView.getUint32(offs, false);
        if (type === OBJTYPE_DOORSCALE) {
            doorScale = setupView.getInt32(offs + 0x04, false) / 65536;
            continue;
        }

        if (type === OBJTYPE_CHR) {
            const spawnFlags = setupView.getUint32(offs + 0x04, false);
            const padNum = setupView.getUint16(offs + 0x0a, false);
            const difficultyFlags = spawnFlags & (SPAWNFLAG_ONLY_AGENT | SPAWNFLAG_ONLY_SPECIAL_AGENT | SPAWNFLAG_ONLY_PERFECT_AGENT);
            if (stage.multiplayer || (spawnFlags & SPAWNFLAG_HIDDEN) !== 0
                    || (difficultyFlags !== 0 && (difficultyFlags & SPAWNFLAG_ONLY_AGENT) === 0)) {
                excludedCount++;
                bump(excludedReasons, stage.multiplayer ? "multiplayer-character" : (spawnFlags & SPAWNFLAG_HIDDEN) !== 0 ? "hidden-character" : "difficulty-character");
                continue;
            }

            const pad = pads[padNum];
            let bodyNum = setupView.getUint8(offs + 0x0c);
            const packedHeadNum = setupView.getInt8(offs + 0x0d);
            if (bodyNum === 0xff)
                bodyNum = 0;
            const bodyState = headBodyStates[bodyNum];
            if (pad === undefined || bodyState === undefined || bodyState.fileId === 0) {
                skippedCount++;
                bump(skippedReasons, pad === undefined ? "character-pad" : "character-body");
                continue;
            }

            const body = getCharacterBody(bodyState);
            if (body.vertices.length === 0) {
                skippedCount++;
                bump(skippedReasons, "empty-character-body");
                continue;
            }

            const localBounds = transformBounds(body, mat4.create());
            const floorQueryPosition: [number, number, number] = [pad.position[0], pad.position[1] + 100, pad.position[2]];
            const collisionFloorY = findFloorYAtCylinder(floorTrianglesByRoom.get(pad.room), pad.position[0], pad.position[2], floorQueryPosition[1], 20);
            const nearbyCollisionFloor = collisionFloorY === null
                ? findFloorAcrossRoomsAtCylinder(floorTrianglesByRoom, pad.room, pad.position[0], pad.position[2], floorQueryPosition[1], 20)
                : null;
            const backgroundFloorY = collisionFloorY === null && nearbyCollisionFloor === null
                ? findFloorYAtCylinder(padRecoveryTrianglesByRoom.get(pad.room), pad.position[0], pad.position[2], floorQueryPosition[1], 20)
                : null;
            const nearbyBackgroundFloor = collisionFloorY === null && nearbyCollisionFloor === null && backgroundFloorY === null
                ? findFloorAcrossRoomsAtCylinder(padRecoveryTrianglesByRoom, pad.room, pad.position[0], pad.position[2], floorQueryPosition[1], 20)
                : null;
            const surfaceY = collisionFloorY ?? nearbyCollisionFloor?.y ?? backgroundFloorY ?? nearbyBackgroundFloor?.y ?? null;
            const surfaceRoom = collisionFloorY !== null || backgroundFloorY !== null ? pad.room
                : nearbyCollisionFloor?.room ?? nearbyBackgroundFloor?.room ?? null;
            const placementMode = collisionFloorY !== null ? "collision-floor"
                : nearbyCollisionFloor !== null ? "nearby-room-collision-floor"
                : backgroundFloorY !== null ? "background-floor"
                : nearbyBackgroundFloor !== null ? "nearby-room-background-floor"
                : "authored-pad-floor";
            const transform = makeCharacterTransform(pad, bodyState.scale, surfaceY);
            const worldBounds = transformBounds(body, transform);
            builder.appendModel(body, transform);
            for (const textureId of body.textureIds)
                builder.textureIds.add(textureId);
            for (const textureSubcommand of body.textureSubcommands)
                builder.textureSubcommands.add(textureSubcommand);

            const characterId = setupView.getInt16(offs + 0x08, false);
            const headNum = packedHeadNum >= 0 ? packedHeadNum : chooseRandomHead(bodyNum, bodyState);
            const sunglasses = (spawnFlags & SPAWNFLAG_FORCESUNGLASSES) !== 0
                || ((spawnFlags & SPAWNFLAG_MAYBESUNGLASSES) !== 0
                    && (hashDeterministicChoice(`${stage.id}:${commandIndex}:${characterId}:sunglasses`) & 1) === 0);
            const headSocketY = appendCharacterHead(bodyState, body, transform, headNum, sunglasses);
            const rootAdjustedTransform = mat4.clone(transform);
            mat4.translate(rootAdjustedTransform, rootAdjustedTransform, [-body.rootPosition[0], -body.rootPosition[1], -body.rootPosition[2]]);
            characterPlacements.push({
                commandIndex,
                characterId,
                bodyNum,
                packedHeadNum,
                headNum,
                spawnFlags,
                sunglasses,
                hasEmbeddedHead: bodyState.hasEmbeddedHead,
                skeletonId: body.skeletonId,
                matrixCount: body.matrixCount,
                padNum,
                padPosition: pad.position,
                padUp: pad.up,
                room: pad.room,
                placementMode,
                floorQueryPosition,
                placementOriginY: transform[13],
                placementContactY: worldBounds[2],
                surfaceY,
                surfaceRoom,
                headSocketY,
                rootPosition: body.rootPosition,
                worldBounds,
                rootAdjustedWorldBounds: transformBounds(body, rootAdjustedTransform),
            });
            charactersById.set(characterId, { transform, model: body, room: pad.room });
            characterCount++;
            continue;
        }

        if (renderableObjectTypes.has(type)) {
            const modelNum = setupView.getInt16(offs + 0x04, false);
            const padNum = setupView.getInt16(offs + 0x06, false);
            const flags = setupView.getUint32(offs + 0x08, false);
            const flags2 = setupView.getUint32(offs + 0x0c, false);
            const flags3 = setupView.getUint32(offs + 0x10, false);
            const extraScale = word0 >>> 16;
            const modelState = modelStates[modelNum];
            const titleTransform = stage.titleSequence && padNum < 0 ? titleSequenceTransforms[titleObjectIndex++] : undefined;
            let pad = pads[padNum];

            const excludedFromAgent = (flags2 & OBJFLAG2_EXCLUDE_AGENT) !== 0;
            const invisibleAtStart = (flags2 & OBJFLAG2_INVISIBLE) !== 0 || conditionallyHidden.has(commandIndex);
            const excludedFromSomePlayerCounts = stage.multiplayer && (flags2 & OBJFLAG2_MULTIPLAYER_PLAYER_COUNT) !== 0;
            const multiplayerRuntimeObject = stage.multiplayer && multiplayerRuntimeObjectTypes.has(type);
            const assignedToCharacter = (flags & OBJFLAG_ASSIGNEDTOCHR) !== 0;
            const insideAnotherObject = (flags & OBJFLAG_INSIDEANOTHEROBJ) !== 0;

            if (excludedFromAgent || invisibleAtStart || excludedFromSomePlayerCounts || multiplayerRuntimeObject || insideAnotherObject) {
                excludedCount++;
                bump(excludedReasons, excludedFromAgent ? "difficulty-object"
                    : invisibleAtStart ? "hidden-object"
                    : excludedFromSomePlayerCounts ? "player-count-object"
                    : multiplayerRuntimeObject ? "multiplayer-runtime-object"
                    : `contained-object-${type.toString(16)}`);
            } else if (assignedToCharacter) {
                const character = charactersById.get(padNum);
                const attachable = (type === OBJTYPE_WEAPON && (flags & OBJFLAG_WEAPON_AICANNOTUSE) === 0) || type === OBJTYPE_HAT;
                if (!attachable || character === undefined || modelState === undefined) {
                    excludedCount++;
                    bump(excludedReasons, !attachable ? `assigned-nonvisible-${type.toString(16)}`
                        : character === undefined ? `assigned-missing-character-${type.toString(16)}` : `assigned-model-${type.toString(16)}`);
                } else {
                    const humanSkeleton = character.model.skeletonId === HUMAN_SKELETON_ID;
                    const part = type === OBJTYPE_HAT ? CHARACTER_HAT_PART
                        : (flags & OBJFLAG_WEAPON_LEFTHANDED) !== 0
                            ? (humanSkeleton ? CHARACTER_LEFT_HAND_PART : SKEDAR_LEFT_HAND_PART)
                            : (humanSkeleton ? CHARACTER_RIGHT_HAND_PART : SKEDAR_RIGHT_HAND_PART);
                    const partTransform = character.model.partTransforms.get(part);
                    const model = getModel(modelState);
                    if (partTransform === undefined || model.vertices.length === 0) {
                        excludedCount++;
                        bump(excludedReasons, partTransform === undefined ? `assigned-part-${type.toString(16)}` : `assigned-empty-model-${type.toString(16)}`);
                    } else {
                        const transform = makeAttachedObjectTransform(character, partTransform, model, modelState.scale * extraScale / 256);
                        const worldBounds = transformBounds(model, transform);
                        appendModel(model, transform);
                        objectCount++;
                        includedTypes.set(type, (includedTypes.get(type) ?? 0) + 1);
                        objectPlacements.push({
                            commandIndex,
                            type,
                            modelNum,
                            padNum,
                            padPosition: null,
                            room: character.room,
                            flags,
                            flags2,
                            flags3,
                            doorFlags: null,
                            doorType: null,
                            hidden: setupView.getUint32(offs + 0x40, false),
                            onAnotherObject: false,
                            supportCommandIndex: null,
                            placementMode: "character-attachment",
                            placementPosition: [transform[12], transform[13], transform[14]],
                            floorQueryPosition: null,
                            placementContactY: null,
                            placementBounds: worldBounds,
                            surfaceY: null,
                            matrixCount: model.matrixCount,
                            rootPosition: model.rootPosition,
                            originOffset: model.originOffset,
                            modelBbox: model.bbox,
                            modelBounds: transformBounds(model, mat4.create()),
                            translation: [transform[12], transform[13], transform[14]],
                            worldBounds,
                        });
                    }
                }
            } else if (modelState === undefined) {
                skippedCount++;
                bump(skippedReasons, `object-model-${type.toString(16)}`);
            } else if ((pad === undefined && titleTransform === undefined) || (pad !== undefined && pad.room <= 0)) {
                excludedCount++;
                bump(excludedReasons, pad === undefined ? `unplaced-object-${type.toString(16)}` : `roomless-object-${type.toString(16)}`);
                if (pad !== undefined)
                    unresolvedRooms.push({ commandIndex, type, padNum, position: pad.position, encodedRoom: pad.room });
            } else {
                const model = getModel(modelState);

                if (model.vertices.length === 0) {
                    skippedCount++;
                    bump(skippedReasons, "empty-object-model");
                } else {
                    const doorFlags = type === OBJTYPE_DOOR ? setupView.getUint16(offs + 0x70, false) : 0;
                    const doorType = type === OBJTYPE_DOOR ? setupView.getUint16(offs + 0x72, false) : 0;
                    const renderedModel = type === OBJTYPE_DOOR ? makeClosedDoorModel(model, doorFlags, doorType) : model;
                    if (type === OBJTYPE_DOOR && pad !== undefined && (doorFlags & DOORFLAG_ROTATEDPAD) !== 0)
                        pad = rotatePadForDoor(pad);
                    if (type === OBJTYPE_DOOR && pad !== undefined && doorScale !== 1) {
                        pad = { ...pad, bbox: [...pad.bbox] as PadData["bbox"] };
                        pad.bbox[0] *= doorScale;
                        pad.bbox[1] *= doorScale;
                    }
                    const placement = titleTransform !== undefined ? null : makeObjectPlacement(
                        pad!, model, modelState.scale, extraScale, flags, type === OBJTYPE_DOOR,
                        floorTrianglesByRoom.get(pad!.room), activeObjects, type, flags3,
                    );
                    const transform = titleTransform !== undefined
                        ? makeAnimatedObjectTransform(titleTransform.position, titleTransform.rotation, model, modelState.scale * extraScale / 256)
                        : placement!.transform;
                    if (type === OBJTYPE_DOOR)
                        applyDoorFlip(transform, doorFlags);
                    if (type === OBJTYPE_DOOR && pad !== undefined && (flags & OBJFLAG_DOOR_KEEPOPEN) !== 0) {
                        const maxFrac = setupView.getInt32(offs + 0x5c, false) / 65536;
                        if (doorType <= 4 || doorType === 8 || doorType === 11) {
                            const vertical = doorType === 4 || doorType === 8;
                            const distance = vertical ? pad.bbox[5] - pad.bbox[4] : pad.bbox[2] - pad.bbox[3];
                            const axis = vertical ? pad.look : pad.up;
                            transform[12] += axis[0] * distance * maxFrac;
                            transform[13] += axis[1] * distance * maxFrac;
                            transform[14] += axis[2] * distance * maxFrac;
                        }
                    }
                    appendModel(renderedModel, transform);
                    if (placement?.onAnotherObject)
                        stackedObjectCount++;
                    if (placement?.collider !== null && placement?.collider !== undefined) {
                        placement.collider.commandIndex = commandIndex;
                        if (placement.onAnotherObject) {
                            activeObjects.push(placement.collider);
                        } else {
                            activeObjects.unshift(placement.collider);
                        }
                    }
                    objectCount++;
                    includedTypes.set(type, (includedTypes.get(type) ?? 0) + 1);
                    const worldBounds = transformBounds(renderedModel, transform);
                    objectPlacements.push({
                        commandIndex,
                        type,
                        modelNum,
                        padNum,
                        padPosition: pad?.position ?? null,
                        room: pad?.room ?? 0,
                        flags,
                        flags2,
                        flags3,
                        doorFlags: type === OBJTYPE_DOOR ? doorFlags : null,
                        doorType: type === OBJTYPE_DOOR ? doorType : null,
                        hidden: setupView.getUint32(offs + 0x40, false),
                        onAnotherObject: placement?.onAnotherObject ?? false,
                        supportCommandIndex: placement?.supportCommandIndex ?? null,
                        placementMode: placement?.placementMode ?? "title-sequence",
                        placementPosition: placement?.placementPosition ?? [transform[12], transform[13], transform[14]],
                        floorQueryPosition: placement?.floorQueryPosition ?? null,
                        placementContactY: placement?.placementContactY ?? null,
                        placementBounds: placement?.placementBounds ?? worldBounds,
                        surfaceY: placement?.surfaceY ?? null,
                        matrixCount: model.matrixCount,
                        rootPosition: model.rootPosition,
                        originOffset: model.originOffset,
                        modelBbox: model.bbox,
                        modelBounds: transformBounds(renderedModel, mat4.create()),
                        translation: [transform[12], transform[13], transform[14]],
                        worldBounds,
                    });
                    if (type === OBJTYPE_DOOR)
                        doorCount++;
                    if (type === OBJTYPE_DOOR && (flags & OBJFLAG_DOOR_KEEPOPEN) !== 0)
                        openDoorCount++;
                }
            }
        }
    }

    let syntheticPadCount = 0;
    let syntheticObjectCount = 0;
    if (stage.characterGallery) {
        const columns = 10;
        const spacingX = 260;
        const spacingZ = 280;
        const firstZ = 5200;
        const padHalfSize = 92;
        for (let galleryIndex = 0; galleryIndex < CHARACTER_GALLERY_BODY_NUMS.length; galleryIndex++) {
            const bodyNum = CHARACTER_GALLERY_BODY_NUMS[galleryIndex];
            const bodyState = headBodyStates[bodyNum];
            if (bodyState === undefined || bodyState.fileId === 0)
                throw new Error(`${stage.id} character gallery body 0x${bodyNum.toString(16)} is unavailable`);
            const body = getCharacterBody(bodyState);
            if (body.vertices.length === 0)
                throw new Error(`${stage.id} character gallery body 0x${bodyNum.toString(16)} has no geometry`);

            const column = galleryIndex % columns;
            const row = Math.floor(galleryIndex / columns);
            const x = (column - (columns - 1) * 0.5) * spacingX;
            const z = firstZ - row * spacingZ;
            const pad: PadData = {
                position: [x, 0, z],
                look: [0, 0, 1],
                up: [0, 1, 0],
                normal: [1, 0, 0],
                bbox: [0, 0, 0, 0, 0, 0],
                hasBbox: false,
                room: 0,
                flags: 0,
            };
            const transform = makeCharacterTransform(pad, bodyState.scale, null);
            const initialWorldBounds = transformBounds(body, transform);
            transform[13] -= initialWorldBounds[2];
            const worldBounds = transformBounds(body, transform);
            appendModel(body, transform);
            const headNum = CHARACTER_GALLERY_HEADS.get(bodyNum)
                ?? (bodyState.isMale ? DEFAULT_MALE_GUARD_HEAD : DEFAULT_FEMALE_GUARD_HEAD);
            const headSocketY = appendCharacterHead(bodyState, body, transform, headNum, false);
            const rootAdjustedTransform = mat4.clone(transform);
            mat4.translate(rootAdjustedTransform, rootAdjustedTransform, [-body.rootPosition[0], -body.rootPosition[1], -body.rootPosition[2]]);
            characterPlacements.push({
                commandIndex: commands.length + galleryIndex,
                characterId: galleryIndex,
                bodyNum,
                packedHeadNum: headNum,
                headNum,
                spawnFlags: 0,
                sunglasses: false,
                hasEmbeddedHead: bodyState.hasEmbeddedHead,
                skeletonId: body.skeletonId,
                matrixCount: body.matrixCount,
                padNum: pads.length + galleryIndex,
                padPosition: pad.position,
                padUp: pad.up,
                room: pad.room,
                placementMode: "gallery-pad",
                floorQueryPosition: pad.position,
                placementOriginY: transform[13],
                placementContactY: worldBounds[2],
                surfaceY: null,
                surfaceRoom: null,
                headSocketY,
                rootPosition: body.rootPosition,
                worldBounds,
                rootAdjustedWorldBounds: transformBounds(body, rootAdjustedTransform),
            });

            const color = (column + row) % 2 === 0 ? 52 : 68;
            const firstVertex = builder.vertexCount;
            for (const [padX, padZ] of [
                [x - padHalfSize, z - padHalfSize],
                [x + padHalfSize, z - padHalfSize],
                [x + padHalfSize, z + padHalfSize],
                [x - padHalfSize, z + padHalfSize],
            ]) {
                builder.addVertex({ x: padX, y: -4, z: padZ, s: 0, t: 0, r: color, g: color + 8, b: color + 16, a: 255 });
            }
            builder.addTriangle(0xffff, 0xffff, 0, firstVertex, firstVertex + 1, firstVertex + 2);
            builder.addTriangle(0xffff, 0xffff, 0, firstVertex, firstVertex + 2, firstVertex + 3);
            syntheticPadCount++;
            characterCount++;
        }
    }

    if (stage.objectGallery !== undefined) {
        const entries = objectGalleryCatalog[stage.objectGallery];
        const columns = 10;
        const spacingX = 260;
        const spacingZ = 280;
        const firstZ = 4800;
        const padHalfSize = 92;
        const targetSize = stage.objectGallery === "items" ? 130 : stage.objectGallery === "doors" ? 190 : 165;
        const baseColor: [number, number, number] = stage.objectGallery === "items" ? [38, 66, 46]
            : stage.objectGallery === "doors" ? [40, 52, 76] : [52, 60, 68];

        for (let galleryIndex = 0; galleryIndex < entries.length; galleryIndex++) {
            const entry = entries[galleryIndex];
            const modelState = modelStates[entry.modelNum];
            if (modelState === undefined || modelState.fileId === 0)
                throw new Error(`${stage.id} object gallery model 0x${entry.modelNum.toString(16)} is unavailable`);
            const model = getModel(modelState);
            const renderedModel = entry.type === OBJTYPE_DOOR
                ? makeClosedDoorModel(model, entry.doorFlags, entry.doorType)
                : model;
            if (renderedModel.vertices.length === 0) {
                skippedCount++;
                bump(skippedReasons, "empty-gallery-model");
                continue;
            }

            const column = galleryIndex % columns;
            const row = Math.floor(galleryIndex / columns);
            const x = (column - (columns - 1) * 0.5) * spacingX;
            const z = firstZ - row * spacingZ;
            const initialScale = modelState.scale * (entry.extraScale || 0x100) / 256;
            let transform = mat4.fromScaling(mat4.create(), [initialScale, initialScale, initialScale]);
            let worldBounds = transformBounds(renderedModel, transform);
            const maximumDimension = Math.max(
                worldBounds[1] - worldBounds[0],
                worldBounds[3] - worldBounds[2],
                worldBounds[5] - worldBounds[4],
            );
            if (!Number.isFinite(maximumDimension) || maximumDimension <= 0)
                throw new Error(`${stage.id} object gallery model 0x${entry.modelNum.toString(16)} has invalid bounds`);
            const galleryScale = initialScale * targetSize / maximumDimension;
            transform = mat4.fromScaling(mat4.create(), [galleryScale, galleryScale, galleryScale]);
            worldBounds = transformBounds(renderedModel, transform);
            transform[12] = x - (worldBounds[0] + worldBounds[1]) * 0.5;
            transform[13] = -worldBounds[2];
            transform[14] = z - (worldBounds[4] + worldBounds[5]) * 0.5;
            worldBounds = transformBounds(renderedModel, transform);
            appendModel(renderedModel, transform);

            const padNum = pads.length + syntheticPadCount;
            const padPosition: [number, number, number] = [x, 0, z];
            objectPlacements.push({
                commandIndex: commands.length + galleryIndex,
                type: entry.type,
                modelNum: entry.modelNum,
                padNum,
                padPosition,
                room: 0,
                flags: 0,
                flags2: 0,
                flags3: 0,
                doorFlags: entry.type === OBJTYPE_DOOR ? entry.doorFlags : null,
                doorType: entry.type === OBJTYPE_DOOR ? entry.doorType : null,
                hidden: 0,
                onAnotherObject: false,
                supportCommandIndex: null,
                placementMode: "gallery-pad",
                placementPosition: [transform[12], transform[13], transform[14]],
                floorQueryPosition: padPosition,
                placementContactY: worldBounds[2],
                placementBounds: worldBounds,
                surfaceY: null,
                matrixCount: model.matrixCount,
                rootPosition: model.rootPosition,
                originOffset: model.originOffset,
                modelBbox: model.bbox,
                modelBounds: transformBounds(renderedModel, mat4.create()),
                translation: [transform[12], transform[13], transform[14]],
                worldBounds,
            });

            const shade = (column + row) % 2 === 0 ? 0 : 14;
            const firstVertex = builder.vertexCount;
            for (const [padX, padZ] of [
                [x - padHalfSize, z - padHalfSize],
                [x + padHalfSize, z - padHalfSize],
                [x + padHalfSize, z + padHalfSize],
                [x - padHalfSize, z + padHalfSize],
            ]) {
                builder.addVertex({
                    x: padX, y: -4, z: padZ, s: 0, t: 0,
                    r: baseColor[0] + shade, g: baseColor[1] + shade, b: baseColor[2] + shade, a: 255,
                });
            }
            builder.addTriangle(0xffff, 0xffff, 0, firstVertex, firstVertex + 1, firstVertex + 2);
            builder.addTriangle(0xffff, 0xffff, 0, firstVertex, firstVertex + 2, firstVertex + 3);
            syntheticPadCount++;
            syntheticObjectCount++;
            objectCount++;
            if (entry.type === OBJTYPE_DOOR)
                doorCount++;
            includedTypes.set(entry.type, (includedTypes.get(entry.type) ?? 0) + 1);
        }
    }

    return {
        data: builder.vertexCount === 0 ? null : builder.build(),
        textureIds: builder.textureIds,
        textureSubcommands: builder.textureSubcommands,
        objectCount,
        doorCount,
        openDoorCount,
        stackedObjectCount,
        characterCount,
        skippedCount,
        excludedCount,
        commandCount: commands.length,
        padCount: pads.length + syntheticPadCount,
        syntheticPadCount,
        syntheticObjectCount,
        unresolvedPadRoomCount,
        navigation,
        skippedReasons,
        excludedReasons,
        includedTypes,
        characterPlacements,
        objectPlacements,
        unresolvedRooms,
    };
}

function runSelfTest(fixturePath?: string): void {
    if (CHARACTER_GALLERY_BODY_NUMS.length !== 68
            || new Set(CHARACTER_GALLERY_BODY_NUMS).size !== CHARACTER_GALLERY_BODY_NUMS.length
            || CHARACTER_GALLERY_BODY_NUMS.includes(0x70)) {
        throw new Error("Perfect Dark extractor self-test did not preserve the character gallery roster");
    }
    if (!isModelDistanceNodeVisible(0, 500, 0)
            || isModelDistanceNodeVisible(500, 1000, 0)
            || !isModelDistanceNodeVisible(500, 1000, 750))
        throw new Error("Perfect Dark extractor self-test did not select the expected model distance branch");
    const collisionFile = Buffer.alloc(0x32);
    collisionFile.writeUInt32BE(1, 0x00);
    collisionFile.writeUInt32BE(0x0c, 0x04);
    collisionFile.writeUInt32BE(collisionFile.byteLength, 0x08);
    collisionFile[0x0c] = 0;
    collisionFile[0x0d] = 4;
    collisionFile.writeUInt16BE(0x0003, 0x0e);
    const collisionVertices: [number, number, number][] = [
        [-100, 75, 200], [300, 75, 200], [300, 75, 500], [-100, 75, 500],
    ];
    for (let i = 0; i < collisionVertices.length; i++) {
        const offs = 0x1a + i * 6;
        collisionFile.writeInt16BE(collisionVertices[i][0], offs + 0x00);
        collisionFile.writeInt16BE(collisionVertices[i][1], offs + 0x02);
        collisionFile.writeInt16BE(collisionVertices[i][2], offs + 0x04);
    }
    const parsedCollision = parseCollisionTiles(collisionFile).get(0);
    if (parsedCollision?.length !== 2 || findFloorY(parsedCollision, 100, 300, 200) !== 75)
        throw new Error("Perfect Dark extractor self-test did not parse collision-tile floors");
    if (findFloorYAtCylinder(parsedCollision, -105, 300, 200, 20) !== 75)
        throw new Error("Perfect Dark extractor self-test did not recover a floor at the character collision-cylinder edge");

    const primarySize = 0x80;
    const roomBaseAddress = BG_ADDRESS_BASE + primarySize;
    const room = Buffer.alloc(0x100);
    const verticesOffset = 0x60;
    const colorsOffset = 0x84;
    const opaqueDisplayListOffset = 0xa0;
    const nestedDisplayListOffset = 0xd0;
    const translucentDisplayListOffset = 0xd8;

    room.writeUInt32BE(roomBaseAddress + verticesOffset, 0x00);
    room.writeUInt32BE(roomBaseAddress + colorsOffset, 0x04);
    room.writeUInt32BE(roomBaseAddress + 0x18, 0x08);
    room.writeUInt32BE(roomBaseAddress + 0x40, 0x0c);

    room[0x18] = 1;
    room.writeUInt32BE(roomBaseAddress + 0x2c, 0x20);
    room.writeUInt32BE(roomBaseAddress + 0x54, 0x24);

    room[0x2c] = 0;
    room.writeUInt32BE(roomBaseAddress + opaqueDisplayListOffset, 0x34);
    room.writeUInt32BE(roomBaseAddress + verticesOffset, 0x38);
    room.writeUInt32BE(roomBaseAddress + colorsOffset, 0x3c);

    room[0x40] = 0;
    room.writeUInt32BE(roomBaseAddress + translucentDisplayListOffset, 0x48);
    room.writeUInt32BE(roomBaseAddress + verticesOffset, 0x4c);
    room.writeUInt32BE(roomBaseAddress + colorsOffset, 0x50);

    const positions: [number, number, number][] = [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
    ];
    for (let i = 0; i < positions.length; i++) {
        const offs = verticesOffset + i * 12;
        room.writeInt16BE(positions[i][0], offs + 0x00);
        room.writeInt16BE(positions[i][1], offs + 0x02);
        room.writeInt16BE(positions[i][2], offs + 0x04);
        room[offs + 0x07] = i * 4;
        room.writeInt16BE(i * 32, offs + 0x08);
        room.writeInt16BE(i * 64, offs + 0x0a);
    }

    room.set([
        0xff, 0x00, 0x00, 0xff,
        0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff,
    ], colorsOffset);

    const writeCommand = (listOffset: number, commandIndex: number, w0: number, w1: number): void => {
        const offs = listOffset + commandIndex * 8;
        room.writeUInt32BE(w0, offs + 0x00);
        room.writeUInt32BE(w1, offs + 0x04);
    };
    writeCommand(opaqueDisplayListOffset, 0, 0x0708000c, 0x0d000000);
    writeCommand(opaqueDisplayListOffset, 1, 0x04000024, 0x0e000000);
    writeCommand(opaqueDisplayListOffset, 2, 0xc0000001, 0x00456123);
    writeCommand(opaqueDisplayListOffset, 3, 0xbf000000, 0x00000a14);
    writeCommand(opaqueDisplayListOffset, 4, 0x06000000, roomBaseAddress + nestedDisplayListOffset);
    writeCommand(opaqueDisplayListOffset, 5, 0xb8000000, 0x00000000);
    writeCommand(nestedDisplayListOffset, 0, 0xb8000000, 0x00000000);

    writeCommand(translucentDisplayListOffset, 0, 0x0708000c, 0x0d000000);
    writeCommand(translucentDisplayListOffset, 1, 0x04000024, 0x0e000000);
    writeCommand(translucentDisplayListOffset, 2, 0xc0000000, 0x00000456);
    writeCommand(translucentDisplayListOffset, 3, 0xb1000001, 0x00000020);
    writeCommand(translucentDisplayListOffset, 4, 0xb8000000, 0x00000000);

    const rareZip = (input: Uint8Array): Buffer => {
        const compressed = deflateRawSync(input);
        const result = Buffer.alloc(5 + compressed.byteLength);
        result[0] = 0x11;
        result[1] = 0x73;
        result[2] = (input.byteLength >>> 16) & 0xff;
        result[3] = (input.byteLength >>> 8) & 0xff;
        result[4] = input.byteLength & 0xff;
        result.set(compressed, 5);
        return result;
    };

    const compressedRoom = rareZip(room);
    const primary = Buffer.alloc(primarySize);
    primary.writeUInt32BE(BG_ADDRESS_BASE + 0x18, 0x04);
    primary.writeUInt32BE(0, 0x18);
    primary.writeUInt32BE(roomBaseAddress, 0x2c);
    primary.writeFloatBE(1, 0x30);
    primary.writeFloatBE(2, 0x34);
    primary.writeFloatBE(3, 0x38);
    primary.writeUInt32BE(roomBaseAddress + compressedRoom.byteLength, 0x40);
    primary.writeUInt32BE(0, 0x54);

    const compressedPrimary = rareZip(primary);
    const bgFile = Buffer.alloc(12 + compressedPrimary.byteLength + compressedRoom.byteLength);
    bgFile.writeUInt32BE(primary.byteLength, 0x00);
    bgFile.writeUInt32BE(compressedPrimary.byteLength + compressedRoom.byteLength, 0x04);
    bgFile.writeUInt32BE(compressedPrimary.byteLength, 0x08);
    bgFile.set(compressedPrimary, 0x0c);
    bgFile.set(compressedRoom, 0x0c + compressedPrimary.byteLength);

    const output = convertBackground(bgFile, 0x01).data;
    const parsed = parsePerfectDarkLevel(ArrayBufferSlice.fromView(output));
    const batchOffset = output.readUInt32LE(0x1c);
    if (output.toString("ascii", 0, 4) !== "PDB1" || parsed.vertexCount !== 6 || parsed.indexCount !== 6 || parsed.batches.length !== 2)
        throw new Error("Perfect Dark extractor self-test produced an invalid PDB1 header");
    if (parsed.boundsMin[0] !== 11 || parsed.boundsMin[1] !== 22 || parsed.boundsMin[2] !== 33 || parsed.boundsMax[0] !== 71 || parsed.boundsMax[1] !== 82 || parsed.boundsMax[2] !== 93)
        throw new Error("Perfect Dark extractor self-test produced invalid map bounds");
    if (output.readFloatLE(PDB1_HEADER_SIZE + 0x00) !== 11 || output.readFloatLE(PDB1_HEADER_SIZE + 0x04) !== 22 || output.readFloatLE(PDB1_HEADER_SIZE + 0x08) !== 33)
        throw new Error("Perfect Dark extractor self-test produced an invalid transformed vertex");
    if (output[PDB1_HEADER_SIZE + 0x14] !== 0xff || output[PDB1_HEADER_SIZE + 0x15] !== 0x00)
        throw new Error("Perfect Dark extractor self-test produced an invalid vertex color");
    if (output.readUInt16LE(batchOffset + 0x08) !== 0x0123 || parsed.batches[0].textureId !== 0x0123
        || parsed.batches[0].secondaryTextureId !== 0x0456 || parsed.batches[0].flags !== BATCH_FLAG_SECONDARY_TEXTURE)
        throw new Error("Perfect Dark extractor self-test produced an invalid texture batch");
    if (parsed.batches[1].textureId !== 0x0456 || parsed.batches[1].secondaryTextureId !== 0xffff
        || parsed.batches[1].flags !== BATCH_FLAG_TRANSLUCENT)
        throw new Error("Perfect Dark extractor self-test produced an invalid translucent batch");

    const modelData = Buffer.alloc(0xc0);
    modelData.writeUInt32BE(0x05000020, 0x00);
    modelData.writeUInt16BE(0x18, 0x20);
    modelData.writeUInt32BE(0x05000038, 0x24);
    modelData.writeUInt32BE(0x05000090, 0x38);
    modelData.writeUInt32BE(0x05000050, 0x44);
    modelData.writeUInt16BE(3, 0x48);
    for (let i = 0; i < positions.length; i++) {
        const offs = 0x50 + i * 16;
        modelData.writeInt16BE(positions[i][0], offs + 0x00);
        modelData.writeInt16BE(positions[i][1], offs + 0x02);
        modelData.writeInt16BE(positions[i][2], offs + 0x04);
        modelData.writeUInt16BE(i * 4, offs + 0x06);
        modelData.writeInt16BE(i * 32, offs + 0x08);
        modelData.writeInt16BE(i * 64, offs + 0x0a);
    }
    modelData.set([
        0xff, 0x00, 0x00, 0xff,
        0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff,
    ], 0x80);
    const writeModelCommand = (commandIndex: number, w0: number, w1: number): void => {
        const offs = 0x90 + commandIndex * 8;
        modelData.writeUInt32BE(w0, offs);
        modelData.writeUInt32BE(w1, offs + 4);
    };
    writeModelCommand(0, 0x0708000c, 0x06000000);
    writeModelCommand(1, 0x04200030, 0x04000000);
    writeModelCommand(2, 0xc0000000, 0x00000123);
    writeModelCommand(3, 0xbf000000, 0x00000a14);
    writeModelCommand(4, 0xb8000000, 0);
    const model = parseModel(modelData);
    if (model.vertices.length !== 3 || model.batches.length !== 1 || model.batches[0].textureId !== 0x0123
        || model.vertices[0].r !== 0xff || model.vertices[1].g !== 0xff || model.vertices[2].b !== 0xff)
        throw new Error("Perfect Dark extractor self-test produced invalid model geometry");
    if (model.originOffset[0] !== 0 || model.originOffset[1] !== 0 || model.originOffset[2] !== 0)
        throw new Error("Perfect Dark extractor self-test shifted model geometry to its collision bbox");
    const deformFixture: ModelGeometry = { ...model, bbox: [40, 70, 20, 50, 0, 100] };
    const verticalDoor = makeClosedDoorModel(deformFixture, DOORFLAG_DEFORM, DOORTYPE_VERTICAL);
    const slidingDoor = makeClosedDoorModel(deformFixture, DOORFLAG_DEFORM, 0);
    if (verticalDoor.vertices[2].y !== 50 || verticalDoor.vertices[0].y !== 20
            || slidingDoor.vertices[0].x !== 40 || slidingDoor.vertices[2].x !== 70)
        throw new Error("Perfect Dark extractor self-test produced invalid closed-door deformation");
    const flippedDoorTransform = mat4.fromTranslation(mat4.create(), [1, 2, 3]);
    applyDoorFlip(flippedDoorTransform, DOORFLAG_FLIP);
    if (flippedDoorTransform[8] !== 0 || flippedDoorTransform[9] !== 0 || flippedDoorTransform[10] !== -1
            || flippedDoorTransform[12] !== 1 || flippedDoorTransform[13] !== 2 || flippedDoorTransform[14] !== 3)
        throw new Error("Perfect Dark extractor self-test produced invalid flipped-door transform");

    const doorPad: PadData = {
        position: [100, 200, 300],
        look: [0, 0, 1],
        up: [0, 1, 0],
        normal: [1, 0, 0],
        bbox: [-1, 1, -1, 1, -1, 1],
        hasBbox: true,
        room: 0,
        flags: 0,
    };
    const groundedCharacterTransform = makeCharacterTransform(doorPad, 1, 75);
    const authoredCharacterTransform = makeCharacterTransform(doorPad, 1, null);
    const facingCharacterTransform = makeCharacterTransform({ ...doorPad, look: [1, 0, 0] }, 1, 75);
    const facingCharacterVertex = vec3.transformMat4(vec3.create(), [0, 0, 1], facingCharacterTransform);
    if (groundedCharacterTransform[12] !== 100 || groundedCharacterTransform[13] !== 175 || groundedCharacterTransform[14] !== 300
            || authoredCharacterTransform[13] !== 200
            || Math.abs(facingCharacterVertex[0] - 101) > 0.0001 || Math.abs(facingCharacterVertex[2] - 300) > 0.0001)
        throw new Error("Perfect Dark extractor self-test produced an invalid character floor or facing transform");

    const characterPlacements: ConvertedStageObjects["characterPlacements"] = [
        {
            commandIndex: 1,
            characterId: 1,
            bodyNum: 1,
            packedHeadNum: -1,
            headNum: DEFAULT_MALE_GUARD_HEAD,
            spawnFlags: SPAWNFLAG_FORCESUNGLASSES,
            sunglasses: true,
            hasEmbeddedHead: false,
            skeletonId: HUMAN_SKELETON_ID,
            matrixCount: 1,
            padNum: 1,
            padPosition: doorPad.position,
            padUp: doorPad.up,
            room: 0,
            placementMode: "collision-floor",
            floorQueryPosition: [100, 300, 300],
            placementOriginY: 175,
            placementContactY: 75,
            surfaceY: 75,
            surfaceRoom: 0,
            headSocketY: 225,
            rootPosition: [0, 0, 0],
            worldBounds: [90, 110, 75, 225, 290, 310],
            rootAdjustedWorldBounds: [90, 110, 75, 225, 290, 310],
        },
        {
            commandIndex: 2,
            characterId: 2,
            bodyNum: 2,
            packedHeadNum: DEFAULT_MALE_GUARD_HEAD,
            headNum: DEFAULT_MALE_GUARD_HEAD,
            spawnFlags: 0,
            sunglasses: false,
            hasEmbeddedHead: false,
            skeletonId: ROBOT_SKELETON_ID,
            matrixCount: 1,
            padNum: 1,
            padPosition: doorPad.position,
            padUp: doorPad.up,
            room: 0,
            placementMode: "authored-pad-floor",
            floorQueryPosition: [100, 300, 300],
            placementOriginY: 200,
            placementContactY: 150,
            surfaceY: null,
            surfaceRoom: null,
            headSocketY: null,
            rootPosition: [0, 0, 0],
            worldBounds: [90, 110, 150, 250, 290, 310],
            rootAdjustedWorldBounds: [90, 110, 150, 250, 290, 310],
        },
    ];
    const characterValidation = validateCharacterPlacements("self-test", characterPlacements);
    if (characterValidation.checkedCount !== 2 || characterValidation.groundedCount !== 1
            || characterValidation.authoredPadFallbackCount !== 1 || characterValidation.uprightHumanCount !== 1
            || characterValidation.maximumRootPlacementError !== 0)
        throw new Error("Perfect Dark extractor self-test did not validate character placement evidence");
    const doorModel: ModelGeometry = {
        ...model,
        bbox: [-1, 1, -1, 1, -1, 1],
        rootPosition: [10, 20, 30],
        originOffset: [0, 0, 0],
    };
    const correctedDoorVertex = vec3.transformMat4(vec3.create(), [0, 0, 1],
        makeObjectTransform(doorPad, doorModel, 1, 0x100, 0, true));
    if (Math.abs(correctedDoorVertex[0] - 101) > 0.0001 || correctedDoorVertex[1] !== 200 || correctedDoorVertex[2] !== 300)
        throw new Error("Perfect Dark extractor self-test did not preserve the door's local origin");

    const oneMatrixProp: ModelGeometry = {
        ...doorModel,
        matrixCount: 1,
    };
    const correctedPropVertex = vec3.transformMat4(vec3.create(), [0, 0, 0],
        makeObjectTransform(doorPad, oneMatrixProp, 1, 0x100, 0x08, false));
    if (correctedPropVertex[0] !== 100 || correctedPropVertex[1] !== 200 || correctedPropVertex[2] !== 300)
        throw new Error("Perfect Dark extractor self-test did not preserve a one-matrix prop origin");
    const orientedPropVertex = vec3.transformMat4(vec3.create(), [1, 0, 1],
        makeObjectTransform(doorPad, oneMatrixProp, 1, 0x100, 0x08, false));
    if (orientedPropVertex[0] !== 101 || orientedPropVertex[1] !== 200 || orientedPropVertex[2] !== 301)
        throw new Error("Perfect Dark extractor self-test did not use the game's prop pad basis");
    const orientedWallVertex = vec3.transformMat4(vec3.create(), [1, 0, 1],
        makeObjectTransform(doorPad, oneMatrixProp, 1, 0x100, 0x02, false));
    if (orientedWallVertex[0] !== 99 || orientedWallVertex[1] !== 201 || orientedWallVertex[2] !== 300)
        throw new Error("Perfect Dark extractor self-test did not use the game's wall-mounted prop pad basis");

    const floorTriangle: FloorTriangle = {
        a: [-100, 75, 200],
        b: [300, 75, 200],
        c: [-100, 75, 500],
    };
    const ceilingTriangle: FloorTriangle = {
        a: [-100, 250, 200],
        b: [300, 250, 200],
        c: [-100, 250, 500],
    };
    const groundedPropVertex = vec3.transformMat4(vec3.create(), [0, 0, 0],
        makeObjectTransform(doorPad, oneMatrixProp, 1, 0x100, 0, false, [floorTriangle, ceilingTriangle]));
    if (groundedPropVertex[0] !== 100 || groundedPropVertex[1] !== 80 || groundedPropVertex[2] !== 300)
        throw new Error("Perfect Dark extractor self-test did not settle a grounded prop on room geometry");

    const contactBboxModel: ModelGeometry = {
        ...oneMatrixProp,
        bbox: [-6, 19, -53, -39, -4, 21],
    };
    const contactBboxPlacement = makeObjectPlacement(
        doorPad, contactBboxModel, 1, 0x100, 0, false, [floorTriangle], [], 0x03, 0,
    );
    const contactBboxOrigin = vec3.transformMat4(vec3.create(), [0, 0, 0], contactBboxPlacement.transform);
    if (contactBboxOrigin[0] !== 100 || contactBboxOrigin[1] !== 132 || contactBboxOrigin[2] !== 300
        || contactBboxPlacement.placementContactY !== 79)
        throw new Error(`Perfect Dark extractor self-test centered visible geometry on an offset contact bbox: ${contactBboxOrigin.join(", ")} / ${contactBboxPlacement.placementContactY}`);

    const supportPlacement = makeObjectPlacement(
        doorPad, oneMatrixProp, 1, 0x100, OBJFLAG_CORE_GEO_INUSE, false,
        [floorTriangle, ceilingTriangle], [], 0x03, 0,
    );
    if (supportPlacement.collider === null)
        throw new Error("Perfect Dark extractor self-test did not create a prop collision block");
    supportPlacement.collider.commandIndex = 7;
    const stackedPlacement = makeObjectPlacement(
        doorPad, oneMatrixProp, 1, 0x100, OBJFLAG_CORE_GEO_INUSE, false,
        [floorTriangle, ceilingTriangle], [supportPlacement.collider], 0x03, 0,
    );
    const stackedPropVertex = vec3.transformMat4(vec3.create(), [0, 0, 0], stackedPlacement.transform);
    if (!stackedPlacement.onAnotherObject || stackedPlacement.supportCommandIndex !== 7 || stackedPropVertex[1] !== 82)
        throw new Error("Perfect Dark extractor self-test did not place a prop on another object's collision block");

    const modelBuilder = new GeometryBuilder();
    modelBuilder.appendModel(model, mat4.create());
    const modelLevel = parsePerfectDarkLevel(ArrayBufferSlice.fromView(modelBuilder.build()));
    const combined = combinePerfectDarkLevels([parsed, modelLevel]);
    const combinedIndices = combined.indexData.createTypedArray(Uint32Array);
    if (combined.vertexCount !== 9 || combined.indexCount !== 9 || combined.batches.length !== 3
        || combinedIndices[parsed.indexCount] < parsed.vertexCount)
        throw new Error("Perfect Dark extractor self-test produced an invalid combined level");

    const manifestFixture: PerfectDarkManifest = {
        manifestVersion: PERFECT_DARK_MANIFEST_VERSION,
        datasetVersion: PERFECT_DARK_DATASET_VERSION,
        formats: { level: PDB1_VERSION, texture: PDT1_VERSION },
        rom: { name: "self-test", md5: "00000000000000000000000000000000" },
        backgroundArchiveCount: 1,
        objectArchiveCount: 1,
        stageCount: 1,
        textureCount: 1,
        stages: [{ id: "self-test", backgroundFileId: 1, hasObjectArchive: true }],
    };
    const parsedManifest = parsePerfectDarkManifest(ArrayBufferSlice.fromView(Buffer.from(JSON.stringify(manifestFixture))));
    if (parsedManifest.stages[0].id !== "self-test" || parsedManifest.objectArchiveCount !== 1)
        throw new Error("Perfect Dark extractor self-test produced an invalid data manifest");

    if (fixturePath !== undefined) {
        const resolvedFixturePath = resolve(fixturePath);
        mkdirSync(dirname(resolvedFixturePath), { recursive: true });
        writeFileSync(resolvedFixturePath, output);
    }

    console.log("Perfect Dark extractor self-test passed (backgrounds, models, character placement, level merging, manifest, and PDB1 output)");
}

function main(): void {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    const romPath = args[0];
    if (romPath === "--self-test") {
        runSelfTest(args[1]);
        return;
    }

    const outputPath = resolve(args[1] ?? "data/PerfectDark");
    if (romPath === undefined) {
        console.error("Usage: pnpm run build:PerfectDark -- <ROMFILE> [OUTPUT_DIRECTORY]");
        process.exitCode = 1;
        return;
    }

    const rom = normalizeRom(readFileSync(romPath));
    const version = identifyRomVersion(rom);
    const md5 = createHash("md5").update(rom).digest("hex");
    if (md5 !== version.md5)
        throw new Error(`Perfect Dark ${version.name} ROM has MD5 ${md5}; expected ${version.md5}`);
    const dataSegment = inflateRareZip(rom.subarray(0x39850), "Perfect Dark data segment");
    const dataView = new DataView(dataSegment.buffer, dataSegment.byteOffset, dataSegment.byteLength);
    const stageTable = parseStageTable(dataSegment);
    const modelStates = parseModelStates(dataSegment, version.modelCount);
    const objectGalleryCatalog = buildObjectGalleryCatalog(rom, dataView, version, stageTable, modelStates);
    const headBodyStates = parseHeadBodyStates(dataSegment);
    const humanStandingPose = parseAnimationPose(rom, version, HUMAN_STANDING_ANIMATION, 0, HUMAN_SKELETON_PART_COUNT);
    const skedarStandingPose = parseAnimationPose(rom, version, SKEDAR_STANDING_ANIMATION, 0, SKEDAR_SKELETON_PART_COUNT);
    const drCarollStandingPose = parseAnimationPose(rom, version, DR_CAROLL_STANDING_ANIMATION, 0, DR_CAROLL_SKELETON_PART_COUNT);
    const robotStandingPose = parseAnimationPose(rom, version, ROBOT_STANDING_ANIMATION, 0, ROBOT_SKELETON_PART_COUNT);
    const characterPoses = new Map<number, AnimationPose>([
        [HUMAN_SKELETON_ID, humanStandingPose],
        [SKEDAR_SKELETON_ID, skedarStandingPose],
        [DR_CAROLL_SKELETON_ID, drCarollStandingPose],
        [ROBOT_SKELETON_ID, robotStandingPose],
    ]);
    const modelCache = new Map<number, ModelGeometry>();
    mkdirSync(outputPath, { recursive: true });

    let totalVertices = 0;
    let totalTriangles = 0;
    const textureIds = new Set<number>();
    const textureSubcommands = new Set<number>();
    const floorTrianglesByBackground = new Map<number, Map<number, FloorTriangle[]>>();
    const roomBoundsByBackground = new Map<number, Map<number, RoomBounds>>();
    for (let fileId = FIRST_BG_FILE_ID; fileId <= LAST_BG_FILE_ID; fileId++) {
        const currentOffset = dataView.getUint32(version.fileTableOffset + fileId * 4, false);
        const nextOffset = dataView.getUint32(version.fileTableOffset + (fileId + 1) * 4, false);
        if (currentOffset === 0 || nextOffset <= currentOffset || nextOffset > rom.byteLength)
            throw new Error(`Invalid ROM file-table entry 0x${fileId.toString(16)}`);

        const result = convertBackground(rom.subarray(currentOffset, nextOffset), fileId);
        floorTrianglesByBackground.set(fileId, result.floorTrianglesByRoom);
        roomBoundsByBackground.set(fileId, result.roomBoundsByRoom);
        const converted = result.data;
        for (const textureId of result.textureIds)
            textureIds.add(textureId);
        for (const textureSubcommand of result.textureSubcommands)
            textureSubcommands.add(textureSubcommand);
        const filename = `${fileId.toString(16).padStart(2, "0")}.pdb1`;
        writeFileSync(resolve(outputPath, filename), converted);
        totalVertices += converted.readUInt32LE(0x08);
        totalTriangles += converted.readUInt32LE(0x0c) / 3;
        console.log(`${filename}: ${converted.readUInt32LE(0x08)} vertices, ${converted.readUInt32LE(0x0c) / 3} triangles`);
    }

    let totalObjects = 0;
    let totalDoors = 0;
    let totalOpenDoors = 0;
    let totalStackedObjects = 0;
    let totalCharacters = 0;
    let totalSkippedObjects = 0;
    let totalExcludedObjects = 0;
    const totalSkippedReasons = new Map<string, number>();
    const totalExcludedReasons = new Map<string, number>();
    const auditStages: object[] = [];
    const manifestStages: PerfectDarkManifest["stages"] = [];
    const collisionTrianglesByFile = new Map<number, Map<number, FloorTriangle[]>>();
    const mergeCounts = (target: Map<string, number>, source: Map<string, number>): void => {
        for (const [reason, count] of source)
            target.set(reason, (target.get(reason) ?? 0) + count);
    };
    const formatCounts = (counts: Map<string, number>): string => [...counts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reason, count]) => `${reason}=${count}`)
        .join(", ");
    for (const stage of stageExtractions) {
        const stageEntry = stageTable[stage.stageIndex];
        let collisionTriangles = collisionTrianglesByFile.get(stageEntry.tileFileId);
        if (collisionTriangles === undefined) {
            collisionTriangles = parseCollisionTiles(readRomFile(rom, dataView, version.fileTableOffset, stageEntry.tileFileId));
            collisionTrianglesByFile.set(stageEntry.tileFileId, collisionTriangles);
        }
        const result = convertStageObjects(
            rom,
            dataView,
            version,
            stage,
            stageEntry,
            modelStates,
            headBodyStates,
            characterPoses,
            modelCache,
            objectGalleryCatalog,
            collisionTriangles,
            roomBoundsByBackground.get(stageEntry.bgFileId) ?? new Map(),
            floorTrianglesByBackground.get(stageEntry.bgFileId) ?? new Map(),
        );
        const placementValidation = validateObjectPlacements(
            stage.id,
            result.objectPlacements,
            roomBoundsByBackground.get(stageEntry.bgFileId) ?? new Map(),
        );
        const characterValidation = validateCharacterPlacements(stage.id, result.characterPlacements);
        if (!stage.id.startsWith("dev-") || stage.characterGallery || stage.objectGallery !== undefined)
            manifestStages.push({ id: stage.id, backgroundFileId: stageEntry.bgFileId, hasObjectArchive: result.data !== null });
        for (const textureId of result.textureIds)
            textureIds.add(textureId);
        for (const textureSubcommand of result.textureSubcommands)
            textureSubcommands.add(textureSubcommand);
        totalObjects += result.objectCount;
        totalDoors += result.doorCount;
        totalOpenDoors += result.openDoorCount;
        totalStackedObjects += result.stackedObjectCount;
        totalCharacters += result.characterCount;
        totalSkippedObjects += result.skippedCount;
        totalExcludedObjects += result.excludedCount;
        mergeCounts(totalSkippedReasons, result.skippedReasons);
        mergeCounts(totalExcludedReasons, result.excludedReasons);
        auditStages.push({
            id: stage.id,
            multiplayer: stage.multiplayer ?? false,
            backgroundFileId: stageEntry.bgFileId,
            collisionTileFileId: stageEntry.tileFileId,
            collisionTriangleCount: [...collisionTriangles.values()].reduce((sum, triangles) => sum + triangles.length, 0),
            commandCount: result.commandCount,
            padCount: result.padCount,
            syntheticPadCount: result.syntheticPadCount,
            syntheticObjectCount: result.syntheticObjectCount,
            unresolvedPadRoomCount: result.unresolvedPadRoomCount,
            navigation: result.navigation,
            objectCount: result.objectCount,
            doorCount: result.doorCount,
            openDoorCount: result.openDoorCount,
            stackedObjectCount: result.stackedObjectCount,
            characterCount: result.characterCount,
            characterValidation,
            placementValidation,
            includedTypes: Object.fromEntries([...result.includedTypes]
                .sort(([a], [b]) => a - b)
                .map(([type, count]) => [`0x${type.toString(16).padStart(2, "0")}`, count])),
            excluded: Object.fromEntries([...result.excludedReasons].sort(([a], [b]) => a.localeCompare(b))),
            skipped: Object.fromEntries([...result.skippedReasons].sort(([a], [b]) => a.localeCompare(b))),
            characterPlacements: result.characterPlacements,
            objectPlacements: result.objectPlacements,
            unresolvedRooms: result.unresolvedRooms,
        });
        if (result.data !== null) {
            writeFileSync(resolve(outputPath, `${stage.id}.pdp1`), result.data);
            console.log(`${stage.id}.pdp1: ${result.objectCount} objects (${result.doorCount} doors, ${result.openDoorCount} initially open, ${result.stackedObjectCount} stacked) and ${result.characterCount} characters, ${result.excludedCount} excluded from initial load, ${result.data.readUInt32LE(0x08)} vertices`);
        } else {
            const stageOutputPath = resolve(outputPath, `${stage.id}.pdp1`);
            if (existsSync(stageOutputPath))
                unlinkSync(stageOutputPath);
            console.log(`${stage.id}: no invariant initial objects; ${result.excludedCount} excluded (background 0x${stageTable[stage.stageIndex].bgFileId.toString(16).padStart(2, "0")})`);
        }
    }

    const textures = [...textureIds].sort((a, b) => a - b).map((textureId) => decodeTexture(rom, version.textureLayout, textureId));
    writeFileSync(resolve(outputPath, "textures.pdt1"), buildTextureBank(textures));
    writeFileSync(resolve(outputPath, "audit.json"), `${JSON.stringify({ rom: { name: version.name, md5 }, stages: auditStages }, null, 2)}\n`);
    const manifest: PerfectDarkManifest = {
        manifestVersion: PERFECT_DARK_MANIFEST_VERSION,
        datasetVersion: PERFECT_DARK_DATASET_VERSION,
        formats: { level: PDB1_VERSION, texture: PDT1_VERSION },
        rom: { name: version.name, md5 },
        backgroundArchiveCount: LAST_BG_FILE_ID - FIRST_BG_FILE_ID + 1,
        objectArchiveCount: manifestStages.filter((stage) => stage.hasObjectArchive).length,
        stageCount: manifestStages.length,
        textureCount: textures.length,
        stages: manifestStages,
    };
    writeFileSync(resolve(outputPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`Extracted ${LAST_BG_FILE_ID} Perfect Dark map archives from ${basename(romPath)} (${version.name})`);
    console.log(`${totalVertices} vertices, ${totalTriangles} triangles, and ${textures.length} textures written to ${outputPath}`);
    console.log(`${totalObjects} placed objects including ${totalDoors} doors (${totalOpenDoors} initially open) and ${totalStackedObjects} object-on-object placements, plus ${totalCharacters} starting characters; ${totalExcludedObjects} excluded by initial-load rules and ${totalSkippedObjects} unplaced or unsupported model instances skipped`);
    console.log(`Excluded: ${formatCounts(totalExcludedReasons)}`);
    console.log(`Skipped: ${formatCounts(totalSkippedReasons) || "none"}`);
    console.log(`Texture command types: ${[...textureSubcommands].sort((a, b) => a - b).join(", ")}`);
}

main();
