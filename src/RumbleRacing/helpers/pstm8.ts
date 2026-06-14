export interface PixelBytes {
  bytes: Uint8Array;
}

export interface Coord {
  x: number;
  y: number;
}

function mapLinearIndexToCoord(linearIndex: number): Coord {
  const yMajor = linearIndex >> 6;
  const iBlock = linearIndex & 0x3f;
  const xMajor = iBlock >> 4;
  const xBase = (xMajor & 1) << 3;
  const xOffset = iBlock & 0x07;
  const x = xBase + xOffset;
  const yMinorBase = (xMajor >> 1) << 1;
  const yMinorOffset = (iBlock >> 3) & 1;
  const y = (yMajor << 2) + yMinorBase + yMinorOffset;
  return { x, y };
}

export function groupBytesIntoChunks(data: Uint8Array, chunkSize: number): PixelBytes[] {
  const chunks: PixelBytes[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, data.length);
    chunks.push({ bytes: data.slice(i, end) });
  }
  return chunks;
}

export function swizzleClutPstm8<T>(data: T[]): T[] {
  if (data.length !== 256) {
    throw new Error(`input array must contain exactly 256 elements, but got ${data.length}`);
  }
  const result = new Array<T>(256);
  for (let i = 0; i < 256; i++) {
    const coord = mapLinearIndexToCoord(i);
    const flatIndex = coord.y * 16 + coord.x;
    result[flatIndex] = data[i];
  }
  return result;
}

export function swizzleClutPstm4_16<T>(data: T[]): T[] {
  if (data.length !== 16) {
    throw new Error(`input must be 16 elements, got ${data.length}`);
  }
  const result = new Array<T>(16);
  for (let i = 0; i < 16; i++) {
    const y = Math.floor(i / 8);
    const x = i % 8;
    const flatIndex = y * 8 + x;
    result[flatIndex] = data[i];
  }
  return result;
}
