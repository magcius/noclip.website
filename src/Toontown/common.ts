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
    if (this.state.useDouble) {
      return this.readFloat64();
    } else {
      return this.readFloat32();
    }
  }

  readUint8Array(length: number): Uint8Array {
    const value = new Uint8Array(this.data.copyToBuffer(this.offs, length));
    this.offs += length;
    return value;
  }

  readBool(): boolean {
    return this.readUint8() !== 0;
  }

  readString(): string {
    const stringLength = this.readUint16();
    const stringBuffer = this.subarray(stringLength).copyToBuffer();
    return new TextDecoder().decode(stringBuffer);
  }

  readVec2(): [number, number] {
    return [this.readStdFloat(), this.readStdFloat()];
  }

  readVec3(): [number, number, number] {
    return [this.readStdFloat(), this.readStdFloat(), this.readStdFloat()];
  }

  readVec4(): [number, number, number, number] {
    return [
      this.readStdFloat(),
      this.readStdFloat(),
      this.readStdFloat(),
      this.readStdFloat(),
    ];
  }

  readMat4(): number[] {
    const m = new Array<number>(16);
    for (let i = 0; i < 16; i++) {
      m[i] = this.readStdFloat();
    }
    return m;
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

  subarray(length: number): ArrayBufferSlice {
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
}
