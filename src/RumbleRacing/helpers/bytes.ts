export function reverseBytesInPlace(b: Uint8Array): void {
  for (let i = 0, j = b.length - 1; i < j; i++, j--) {
    const tmp = b[i];
    b[i] = b[j];
    b[j] = tmp;
  }
}

export class BinaryReader {
  private view: DataView;
  pos: number = 0;

  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get length(): number {
    return this.data.length;
  }

  seek(offset: number): void {
    this.pos = offset;
  }

  tell(): number {
    return this.pos;
  }

  readUint8(): number {
    return this.view.getUint8(this.pos++);
  }

  readUint16LE(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUint32LE(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readFloat32LE(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readBytes(n: number): Uint8Array {
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  slice(start: number, end?: number): Uint8Array {
    return this.data.slice(start, end);
  }

  eof(): boolean {
    return this.pos >= this.data.length;
  }
}

export function readUint32LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

export function readUint16LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

export function readInt16LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(offset, true);
}

export function readFloat32LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(offset, true);
}

export function uint32ToFloat32(bits: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, bits, true);
  return new DataView(buf).getFloat32(0, true);
}

export function nullTerminatedString(data: Uint8Array): string {
  const end = data.indexOf(0);
  const slice = end === -1 ? data : data.slice(0, end);
  return new TextDecoder().decode(slice);
}
