import type { mat4, vec2, vec3, vec4 } from "gl-matrix";
import type ArrayBufferSlice from "../ArrayBufferSlice";

export class AssetVersion {
  constructor(
    public major: number,
    public minor: number,
  ) {}

  compare(other: AssetVersion): number {
    return this.major !== other.major
      ? this.major - other.major
      : this.minor - other.minor;
  }

  equals(other: AssetVersion): boolean {
    return this.major === other.major && this.minor === other.minor;
  }

  toString(): string {
    return `${this.major}.${this.minor}`;
  }
}

export class DataStreamState {
  constructor(
    public littleEndian = true,
    public useDouble = false,
    public longObjectIds = false,
    // Global PTA cache shared across all objects in the BAM file
    public ptaCache = new Map<number, unknown>(),
  ) {}
}

export class DataStream {
  private _view: DataView;

  constructor(
    public data: ArrayBufferSlice,
    public offs: number = 0,
    public state = new DataStreamState(),
  ) {
    this._view = data.createDataView();
  }

  readUint8(): number {
    const value = this._view.getUint8(this.offs);
    this.offs += 1;
    return value;
  }

  readUint16(): number {
    const value = this._view.getUint16(this.offs, this.state.littleEndian);
    this.offs += 2;
    return value;
  }

  readUint32(): number {
    const value = this._view.getUint32(this.offs, this.state.littleEndian);
    this.offs += 4;
    return value;
  }

  readInt8(): number {
    const value = this._view.getInt8(this.offs);
    this.offs += 1;
    return value;
  }

  readInt16(): number {
    const value = this._view.getInt16(this.offs, this.state.littleEndian);
    this.offs += 2;
    return value;
  }

  readInt32(): number {
    const value = this._view.getInt32(this.offs, this.state.littleEndian);
    this.offs += 4;
    return value;
  }

  readUint64(): bigint {
    const value = this._view.getBigUint64(this.offs, this.state.littleEndian);
    this.offs += 8;
    return value;
  }

  readFloat32(): number {
    const value = this._view.getFloat32(this.offs, this.state.littleEndian);
    this.offs += 4;
    return value;
  }

  readFloat64(): number {
    const value = this._view.getFloat64(this.offs, this.state.littleEndian);
    this.offs += 8;
    return value;
  }

  readStdFloat(): number {
    return this.state.useDouble ? this.readFloat64() : this.readFloat32();
  }

  readUint8Array(length: number): Uint8Array {
    const value = new Uint8Array(this.data.copyToBuffer(this.offs, length));
    this.offs += length;
    return value;
  }

  readUint16Array(length: number): Uint16Array {
    if (!this.state.littleEndian)
      throw new Error("TODO readUint16Array big endian");
    const value = new Uint16Array(
      this.data.copyToBuffer(this.offs, length * 2),
    );
    this.offs += length * 2;
    return value;
  }

  readInt32Array(length: number): Int32Array {
    if (!this.state.littleEndian)
      throw new Error("TODO readInt32Array big endian");
    const value = new Int32Array(this.data.copyToBuffer(this.offs, length * 4));
    this.offs += length * 4;
    return value;
  }

  readFloat32Array(length: number): Float32Array {
    if (!this.state.littleEndian)
      throw new Error("TODO readFloat32Array big endian");
    const value = new Float32Array(
      this.data.copyToBuffer(this.offs, length * 4),
    );
    this.offs += length * 4;
    return value;
  }

  readBool(): boolean {
    return this.readUint8() !== 0;
  }

  readString(): string {
    const length = this.readUint16();
    const buffer = this.data.copyToBuffer(this.offs, length);
    this.offs += length;
    return new TextDecoder().decode(buffer);
  }

  readVec2(): vec2 {
    return this.readFloat32Array(2);
  }

  readVec3(): vec3 {
    return this.readFloat32Array(3);
  }

  readVec4(): vec4 {
    return this.readFloat32Array(4);
  }

  readMat4(): mat4 {
    return this.readFloat32Array(16);
  }

  readObjectId(): number {
    let value: number;
    if (this.state.longObjectIds) {
      value = this.readUint32();
    } else {
      value = this.readUint16();
      if (value === 0xffff) {
        this.state.longObjectIds = true;
      }
    }
    return value;
  }

  subarray(length?: number): ArrayBufferSlice {
    if (length === undefined) length = this.remaining();
    const value = this.data.subarray(this.offs, length);
    this.offs += length;
    return value;
  }

  substream(length: number): DataStream {
    const stream = new DataStream(
      this.data.subarray(this.offs, length),
      0,
      // Substreams share the same state object: this allows settings like
      // longObjectIds to be updated globally across all streams.
      this.state,
    );
    this.offs += length;
    return stream;
  }

  remaining(): number {
    return this.data.byteLength - this.offs;
  }

  readPtaVec2(): Float32Array {
    return this.readPtaInternal((size) => this.readFloat32Array(size * 2));
  }

  readPtaVec3(): Float32Array {
    return this.readPtaInternal((size) => this.readFloat32Array(size * 3));
  }

  readPtaVec4(): Float32Array {
    return this.readPtaInternal((size) => this.readFloat32Array(size * 4));
  }

  readPtaUint16(): Uint16Array {
    return this.readPtaInternal((size) => this.readUint16Array(size));
  }

  readPtaInt32(): Int32Array {
    return this.readPtaInternal((size) => this.readInt32Array(size));
  }

  private readPtaInternal<T>(cb: (size: number) => T): T {
    const ptaId = this.readObjectId();
    if (ptaId !== 0 && this.state.ptaCache.has(ptaId))
      return this.state.ptaCache.get(ptaId) as T;
    const result = cb(this.readUint32());
    if (ptaId !== 0) this.state.ptaCache.set(ptaId, result);
    return result;
  }
}

export function enumName(
  value: number,
  enumObj: Record<number, string>,
): string {
  return enumObj[value] ?? `Unknown(${value})`;
}
