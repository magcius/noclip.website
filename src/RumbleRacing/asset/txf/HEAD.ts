import { readUint32LE, readUint16LE } from "../../helpers/bytes";

export interface HEAD {
  size: number;
  allocBytes: number;
  totalTextures: number;
  clheIterations: number;
  zthesCount: number;
  headPointerCount: number;
  unusedByte: number;
  ztheFilePointers: number[];
}

export function parseHEAD(buf: Uint8Array): HEAD {
  const size = readUint32LE(buf, 4);
  const alloc = readUint16LE(buf, 8);
  const totalTextures = readUint16LE(buf, 10);
  const clheIterations = buf[12];
  const zthesCount = buf[13];
  const headPointerCount = buf[14];
  const unusedByte = buf[15];

  const pointers = buf.slice(16);
  const ptrs: number[] = [];
  for (let i = 0; i + 4 <= pointers.length; i += 4) {
    ptrs.push(readUint32LE(pointers, i));
  }

  return { size, allocBytes: alloc, totalTextures, clheIterations, zthesCount, headPointerCount, unusedByte, ztheFilePointers: ptrs };
}
