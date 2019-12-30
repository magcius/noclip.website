
import ArrayBufferSlice from '../ArrayBufferSlice';
import { vec3, quat, mat4, mat3 } from 'gl-matrix';
import { align } from '../util';
import * as rw from 'librw';
import { Color, colorNew } from '../Color';
import { Camera, computeViewSpaceDepthFromWorldSpacePoint } from '../Camera';
import { AABB } from '../Geometry';
import { clamp } from '../MathHelpers';

export function stringHash(str: string): number {
    let hash = 0;
    
    for (let i = 0; i < str.length; i++) {
        let ch = str.charCodeAt(i);
        ch -= ch & (ch >>> 1) & 0x20; // quick and dirty lowercase
        hash = ch + hash * 131;
    }

    return hash;
}

// based on RotationYawPitchRoll() from SharpDX
// https://github.com/sharpdx/SharpDX/blob/master/Source/SharpDX.Mathematics/Quaternion.cs
export function quatFromYPR(out: quat, ypr: vec3) {
    const halfRoll = ypr[2] * 0.5;
    const halfPitch = ypr[1] * 0.5;
    const halfYaw = ypr[0] * 0.5;

    const sinRoll = Math.sin(halfRoll);
    const cosRoll = Math.cos(halfRoll);
    const sinPitch = Math.sin(halfPitch);
    const cosPitch = Math.cos(halfPitch);
    const sinYaw = Math.sin(halfYaw);
    const cosYaw = Math.cos(halfYaw);

    out[0] = (cosYaw * sinPitch * cosRoll) + (sinYaw * cosPitch * sinRoll);
    out[1] = (sinYaw * cosPitch * cosRoll) - (cosYaw * sinPitch * sinRoll);
    out[2] = (cosYaw * cosPitch * sinRoll) - (sinYaw * sinPitch * cosRoll);
    out[3] = (cosYaw * cosPitch * cosRoll) + (sinYaw * sinPitch * sinRoll);
}

const scratchVec3 = vec3.create();

export function aabbClosestPoint(out: vec3, aabb: AABB, v: vec3) {
    out[0] = clamp(v[0], aabb.minX, aabb.maxX);
    out[1] = clamp(v[1], aabb.minY, aabb.maxY);
    out[2] = clamp(v[2], aabb.minZ, aabb.maxZ);
}

export function computeViewSpaceDepthFromWorldSpaceAABBClosestPoint(camera: Camera, aabb: AABB, v: vec3 = scratchVec3): number {
    mat4.getTranslation(v, camera.worldMatrix);
    aabbClosestPoint(v, aabb, v);
    return computeViewSpaceDepthFromWorldSpacePoint(camera, v);
}

const scratchQuat = quat.create();

export function mat4FromYPR(out: mat4, ypr: vec3) {
    quatFromYPR(scratchQuat, ypr);
    mat4.fromQuat(out, scratchQuat);
}

export class DataStream {
    public offset: number = 0;
    public readonly view: DataView;

    constructor(public readonly buffer: ArrayBufferSlice, private littleEndian = true) {
        this.view = buffer.createDataView();
    }

    public readUInt8(): number {
        const x = this.view.getUint8(this.offset);
        this.offset += 1;
        return x;
    }

    public readUInt16(): number {
        const x = this.view.getUint16(this.offset, this.littleEndian);
        this.offset += 2;
        return x;
    }

    public readUInt32(): number {
        const x = this.view.getUint32(this.offset, this.littleEndian);
        this.offset += 4;
        return x;
    }

    public readInt8(): number {
        const x = this.view.getInt8(this.offset);
        this.offset += 1;
        return x;
    }

    public readInt16(): number {
        const x = this.view.getInt16(this.offset, this.littleEndian);
        this.offset += 2;
        return x;
    }

    public readInt32(): number {
        const x = this.view.getInt32(this.offset, this.littleEndian);
        this.offset += 4;
        return x;
    }

    public readFloat(): number {
        const x = this.view.getFloat32(this.offset, this.littleEndian);
        this.offset += 4;
        return x;
    }

    public readString(maxLength: number = Infinity): string {
        let s = '';

        for (let i = 0; i < maxLength; i++) {
            const c = this.view.getUint8(this.offset++);
            if (c === 0)
                break;
            s += String.fromCharCode(c);
        }

        return s;
    }

    public readVec3(): vec3 {
        const x = this.readFloat();
        const y = this.readFloat();
        const z = this.readFloat();

        return vec3.fromValues(x, y, z);
    }

    public readRwMatrix(): mat4 {
        const right = this.readVec3();
        const pad0 = this.readFloat();
        const up = this.readVec3();
        const pad1 = this.readFloat();
        const at = this.readVec3();
        const pad2 = this.readFloat();
        const pos = this.readVec3();
        const pad3 = this.readFloat();
        vec3.normalize(right, right);
        vec3.normalize(up, up);
        vec3.normalize(at, at);
        
        return mat4.fromValues(
            right[0], right[1], right[2], pad0,
            up[0],    up[1],    up[2],    pad1,
            at[0],    at[1],    at[2],    pad2,
            pos[0],   pos[1],   pos[2],   pad3
        );
    }

    public readColor(): Color {
        const r = this.readFloat();
        const g = this.readFloat();
        const b = this.readFloat();
        const a = this.readFloat();

        return colorNew(r, g, b, a);
    }

    public readColor8(): Color {
        const r = this.readUInt8() / 255;
        const g = this.readUInt8() / 255;
        const b = this.readUInt8() / 255;
        const a = this.readUInt8() / 255;

        return colorNew(r, g, b, a);
    }

    public align(multiple: number): void {
        this.offset = align(this.offset, multiple);
    }

    public eof(): boolean {
        return this.offset >= this.view.byteLength;
    }

    public get length(): number {
        return this.view.byteLength;
    }

    public get bytesLeft(): number {
        return this.length - this.offset;
    }
}

export class DataCacheIDName<T> {
    private nameToDataMap = new Map<string, T>();
    private idToDataMap = new Map<number, T>();

    private nameToLockMap = new Map<string, boolean>();
    private idToLockMap = new Map<number, boolean>();

    public get count() { return this.idToDataMap.size; }

    public add(data: T, name: string, id: number, lock: boolean = false) {
        if (!this.idToLockMap.get(id)) {
            this.nameToDataMap.set(name, data);
            this.idToDataMap.set(id, data);
            this.nameToLockMap.set(name, lock);
            this.idToLockMap.set(id, lock);
        }
    }

    public getByName(name: string) {
        return this.nameToDataMap.get(name);
    }

    public getByID(id: number) {
        return this.idToDataMap.get(id);
    }

    public ids() {
        return this.idToDataMap.keys();
    }

    public names() {
        return this.nameToDataMap.keys();
    }

    public data() {
        return this.idToDataMap.values();
    }

    public isIDLocked(id: number) {
        return this.idToLockMap.get(id) || false;
    }

    public isNameLocked(name: string) {
        return this.nameToLockMap.get(name) || false;
    }

    public removeByName(name: string, force: boolean = false) {
        if (force || !this.isNameLocked(name)) {
            this.nameToDataMap.delete(name);
            this.nameToLockMap.delete(name);
        }
    }

    public removeByID(id: number, force: boolean = false) {
        if (force || !this.isIDLocked(id)) {
            this.idToDataMap.delete(id);
            this.idToLockMap.delete(id);
        }
    }

    // Clears just unlocked data or all data
    public clear(all: boolean = false) {
        for (const [id] of this.idToDataMap)
            this.removeByID(id, all);
        for (const [name] of this.nameToDataMap)
            this.removeByName(name, all);
    }
}

export interface RWChunkHeader {
    type: number;
    length: number;
    libraryID: number;
}

export interface RWChunk {
    header: RWChunkHeader;
    data: ArrayBufferSlice;
    children: RWChunk[];
}

export interface RWAtomicStruct {
    frameIndex: number;
    geomIndex: number;
    flags: number;
    unused: number;
}

export const enum RWAtomicFlags {
    CollisionTest = 0x1,
    Render = 0x4
}

export interface RWClumpStruct {
    numAtomics: number;
    numLights: number;
    numCameras: number;
}

function RWChunkHasChildren(type: number): boolean {
    switch (type) {
        case rw.PluginID.ID_STRUCT:
        case rw.PluginID.ID_STRING:
        case rw.PluginID.ID_RIGHTTORENDER:
            return false;
        default:
            return (type & 0x100) ? false : true;
    }
}

function parseRWChunkHeader(stream: DataStream): RWChunkHeader {
    const type = stream.readUInt32();
    const length = stream.readUInt32();
    const libraryID = stream.readUInt32();
    return { type, length, libraryID };
}

function parseRWChunk(stream: DataStream): RWChunk {
    const header = parseRWChunkHeader(stream);
    const end = stream.offset + header.length;
    const data = stream.buffer.slice(stream.offset, end);
    const children: RWChunk[] = [];
    if (RWChunkHasChildren(header.type)) {
        while (stream.offset < end)
            children.push(parseRWChunk(stream));
    } else {
        stream.offset = end;
    }
    return { header, data, children };
}

export function parseRWChunks(buffer: ArrayBufferSlice): RWChunk[] {
    const chunks: RWChunk[] = [];
    const stream = new DataStream(buffer, true);
    while (!stream.eof())
        chunks.push(parseRWChunk(stream));
    return chunks;
}

export function createRWStreamFromChunk(chunk: RWChunk): rw.StreamMemory {
    return new rw.StreamMemory(chunk.data.createTypedArray(Uint8Array));
}

export function parseRWAtomic(struct: RWChunk): RWAtomicStruct {
    const stream = new DataStream(struct.data, true);
    const frameIndex = stream.readInt32();
    const geomIndex = stream.readInt32();
    const flags = stream.readInt32();
    const unused = stream.readInt32();
    return { frameIndex, geomIndex, flags, unused };
}

export function parseRWClump(struct: RWChunk): RWClumpStruct {
    const stream = new DataStream(struct.data, true);
    const numAtomics = stream.readInt32();
    const numLights = stream.readInt32();
    const numCameras = stream.readInt32();
    return { numAtomics, numLights, numCameras };
}